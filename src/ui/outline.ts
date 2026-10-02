/**
 * The outline docks to the right of the document, between the titlebar and
 * the status bar, and the document makes room for it; a panel floating over
 * the page hid the text under it. The heading being read is marked as the
 * page scrolls, and the list scrolls to keep that heading in view.
 *
 * Escape leaves it open: it is part of the window like the status bar, and
 * the Escape that closed the slash menu closed the outline with it.
 */

import type { NyaEditor } from '../editor/editor';
import { translateDOM } from '../i18n/dom';
import { ensureStyle } from '../style/register';

const outlineStyles = `
:root {
  --ny-outline-width: clamp(200px, 22vw, 280px);
}

:root.ny-outline-open .ny-shell__body {
  margin-right: var(--ny-outline-width);
}

.ny-outline {
  position: fixed;
  top: 40px;
  right: 0;
  bottom: 32px;
  width: var(--ny-outline-width);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-left: 1px solid var(--ny-border-strong);
  background: color-mix(in srgb, var(--ny-text-primary) 2.5%, transparent);
  z-index: 1;
  user-select: none;
  -webkit-user-select: none;
}

.ny-outline[hidden] {
  display: none;
}

.ny-outline__header {
  flex: none;
  padding: 14px 18px 8px;
  color: var(--ny-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ny-outline__list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 16px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ny-text-muted), transparent 56%) transparent;
}

.ny-outline__empty {
  padding: 4px 10px;
  color: var(--ny-text-muted);
  font-size: 12px;
}

.ny-outline__item {
  position: relative;
  padding: 4px 8px 4px calc(10px + var(--outline-indent, 0px));
  border-radius: 6px;
  color: var(--ny-text-secondary);
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.ny-outline__item:is([data-depth="0"], [data-depth="1"]) {
  color: var(--ny-text-primary);
}

.ny-outline__item[data-depth="0"] {
  font-weight: 600;
}

.ny-outline__item[data-depth="0"]:not(:first-child) {
  margin-top: 6px;
}

.ny-outline__item:is([data-depth="2"], [data-depth="3"], [data-depth="4"]) {
  font-size: 12.5px;
}

.ny-outline__item:hover {
  background: color-mix(in srgb, var(--ny-text-primary) 5%, transparent);
  color: var(--ny-text-primary);
}

.ny-outline__item.is-active {
  background: color-mix(in srgb, var(--ny-accent) 13%, transparent);
  color: var(--ny-accent);
}

.ny-outline__item.is-active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: var(--ny-accent);
}
`;

/** Pause after the last document change before the list is refreshed. */
const RENDER_DELAY_MS = 150;
/**
 * A heading is the one being read once its top is less than this far below
 * the top of the page. `scrollToHeading` leaves a heading 72px down, under
 * the sticky top bar.
 */
const READING_LINE_PX = 96;
/** Room kept above and below the marked heading when the list follows it. */
const REVEAL_MARGIN_PX = 28;
/** Deeper headings share the indent of the fifth level. */
const MAX_DEPTH = 4;

type Heading = { id: string; level: number; text: string };

/** The element the document scrolls in: the preview pane in source mode. */
function scrollHostOf(el: Element): Element | null {
  return (
    el.closest('#editor-container.is-source-mode > .milkdown') ??
    el.closest('.ny-shell__body')
  );
}

export class OutlinePanel {
  private readonly elPanel: HTMLElement;
  private readonly elList: HTMLElement;
  private isVisible = false;
  private headings: Heading[] = [];
  private activeId: string | null = null;
  /** The clicked heading stays marked until the user scrolls themselves. */
  private pinnedId: string | null = null;
  /** Identity of the rendered headings; equal headings keep the DOM. */
  private renderedSignature: string | null = null;
  private renderTimer: number | null = null;
  private spyFrame: number | null = null;
  private readonly unsubscribe: () => void;

  /** `goTo` takes the page to a heading clicked in the list. */
  constructor(
    private editor: NyaEditor,
    private goTo = (id: string) => editor.scrollToHeading(id)
  ) {
    ensureStyle('outline-panel', outlineStyles);

    this.elPanel = document.createElement('div');
    this.elPanel.className = 'ny-outline';
    this.elPanel.hidden = true;

    const header = document.createElement('div');
    header.className = 'ny-outline__header';
    header.textContent = 'Outline';
    header.setAttribute('data-i18n', 'outline.title');

    this.elList = document.createElement('div');
    this.elList.className = 'ny-outline__list';
    // The caret stays in the document, so typing goes on after a jump.
    this.elList.addEventListener('mousedown', (event) =>
      event.preventDefault()
    );
    this.elList.addEventListener('click', this.onClick);

    this.elPanel.appendChild(header);
    this.elPanel.appendChild(this.elList);
    document.body.appendChild(this.elPanel);
    translateDOM(this.elPanel);

    // Toggling is a global shortcut (see features/shortcut-controller.ts).
    this.unsubscribe = editor.onDocChanged(() => this.scheduleRender());
  }

  destroy() {
    this.hide();
    this.unsubscribe();
    if (this.renderTimer != null) window.clearTimeout(this.renderTimer);
    this.elPanel.remove();
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.keepReadingPosition(() => {
      this.elPanel.hidden = false;
      document.documentElement.classList.add('ny-outline-open');
    });
    this.setPressed(true);
    document.addEventListener('scroll', this.onScroll, {
      capture: true,
      passive: true,
    });
    for (const type of ['wheel', 'touchmove', 'keydown', 'mousedown']) {
      document.addEventListener(type, this.releasePin, {
        capture: true,
        passive: true,
      });
    }
    this.renderOutline();
    this.updateActive();
  }

  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.keepReadingPosition(() => {
      this.elPanel.hidden = true;
      document.documentElement.classList.remove('ny-outline-open');
    });
    this.setPressed(false);
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    for (const type of ['wheel', 'touchmove', 'keydown', 'mousedown']) {
      document.removeEventListener(type, this.releasePin, { capture: true });
    }
    if (this.spyFrame != null) cancelAnimationFrame(this.spyFrame);
    this.spyFrame = null;
    this.pinnedId = null;
  }

  private setPressed(pressed: boolean) {
    document
      .getElementById('tb-outline')
      ?.setAttribute('aria-pressed', String(pressed));
  }

  /**
   * The document reflows when the outline opens or closes. The line at the
   * top of the page is put back where it was, or the reader lost their place.
   */
  private keepReadingPosition(change: () => void) {
    const view = this.editor.getView();
    const host = view && scrollHostOf(view.dom);
    if (!view || !host || host.scrollTop === 0) {
      change();
      return;
    }
    const box = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({
      left: box.left + box.width / 2,
      top: host.getBoundingClientRect().top + READING_LINE_PX,
    });
    const before = hit && view.coordsAtPos(hit.pos).top;
    change();
    if (hit && before != null) {
      host.scrollTop += view.coordsAtPos(hit.pos).top - before;
    }
  }

  /** A burst of keystrokes is rendered once, after it ends. */
  private scheduleRender() {
    if (!this.isVisible || this.renderTimer != null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.renderOutline();
      this.updateActive();
    }, RENDER_DELAY_MS);
  }

  /**
   * Rebuild the list only when the headings differ from what is shown, and
   * keep the scroll position when they do; a rebuild on every change would
   * yank the list back to the top while the user is reading it.
   */
  private renderOutline() {
    const items: Heading[] = this.editor.getOutline();
    const signature = items
      .map((item) => `${item.level}\u0000${item.id}\u0000${item.text}`)
      .join('\n');
    if (signature === this.renderedSignature) return;
    this.renderedSignature = signature;
    this.headings = items;

    const scrollTop = this.elList.scrollTop;
    this.elList.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ny-outline__empty';
      empty.textContent = 'No headings found';
      empty.setAttribute('data-i18n', 'outline.empty');
      this.elList.appendChild(empty);
      translateDOM(this.elList);
      return;
    }

    // A document that starts at level 2 is not indented one step for nothing.
    const top = Math.min(...items.map((item) => item.level));
    for (const item of items) {
      const depth = Math.min(item.level - top, MAX_DEPTH);
      const el = document.createElement('div');
      el.className = 'ny-outline__item';
      el.dataset.depth = String(depth);
      el.dataset.id = item.id;
      el.style.setProperty('--outline-indent', `${depth * 14}px`);
      el.textContent = item.text;
      el.title = item.text;
      el.classList.toggle('is-active', item.id === this.activeId);
      this.elList.appendChild(el);
    }
    this.elList.scrollTop = scrollTop;
  }

  private onClick = (event: MouseEvent) => {
    const item = (event.target as Element).closest<HTMLElement>(
      '.ny-outline__item'
    );
    const id = item?.dataset.id;
    if (!id) return;
    // A heading near the end cannot scroll up to the reading line.
    this.pinnedId = id;
    this.setActive(id, false);
    this.goTo(id);
  };

  private releasePin = (event: Event) => {
    if (this.elPanel.contains(event.target as Node)) return;
    this.pinnedId = null;
  };

  private onScroll = (event: Event) => {
    if (this.pinnedId || this.spyFrame != null) return;
    if (this.elPanel.contains(event.target as Node)) return;
    this.spyFrame = requestAnimationFrame(() => {
      this.spyFrame = null;
      this.updateActive();
    });
  };

  private updateActive() {
    if (!this.pinnedId) this.setActive(this.headingBeingRead(), true);
  }

  /**
   * The last heading above the reading line, or, above the first heading,
   * the first heading on screen. The headings of a short last section never
   * reach the line, so at the end of the page the last one on screen counts.
   */
  private headingBeingRead(): string | null {
    const els = this.headings
      .map((heading) => document.getElementById(heading.id))
      .filter((el): el is HTMLElement => el != null);
    const host = els[0] && scrollHostOf(els[0]);
    if (!host) return null;
    const box = host.getBoundingClientRect();
    const atEnd =
      host.scrollTop > 0 &&
      host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
    const line = atEnd ? box.bottom : box.top + READING_LINE_PX;
    let current: HTMLElement | null = null;
    for (const el of els) {
      const { top } = el.getBoundingClientRect();
      if (top > line) {
        if (!current && top < box.bottom) current = el;
        break;
      }
      current = el;
    }
    return current?.id ?? null;
  }

  private setActive(id: string | null, reveal: boolean) {
    if (id === this.activeId) return;
    this.activeId = id;
    let active: HTMLElement | null = null;
    for (const el of this.elList.children) {
      const on = (el as HTMLElement).dataset.id === id;
      el.classList.toggle('is-active', on);
      if (on) active = el as HTMLElement;
    }
    // The list stays put while the pointer is on it.
    if (reveal && active && !this.elList.matches(':hover')) {
      this.reveal(active);
    }
  }

  private reveal(item: HTMLElement) {
    const list = this.elList;
    const top = item.offsetTop - REVEAL_MARGIN_PX;
    const bottom = item.offsetTop + item.offsetHeight + REVEAL_MARGIN_PX;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }
}
