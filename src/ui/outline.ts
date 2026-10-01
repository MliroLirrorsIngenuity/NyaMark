import { NyaEditor } from '../editor/editor';
import { ensureStyle } from '../style/register';
import { translateDOM } from '../i18n/dom';
import { pushEscapeLayer } from './escape-layers';

const outlineStyles = `
.ny-outline {
  position: fixed;
  top: 64px;
  right: 16px;
  bottom: 64px;
  width: 284px;
  display: flex;
  flex-direction: column;
  padding: 18px 16px 16px 18px;
  box-sizing: border-box;
  border: 1px solid var(--ny-border-strong);
  border-radius: 24px;
  background: var(--ny-surface-ghost);
  box-shadow: var(--ny-shadow-float);
  backdrop-filter: blur(22px) saturate(1.2);
  -webkit-backdrop-filter: blur(22px) saturate(1.2);
  transition: opacity 0.15s ease, transform 0.18s ease;
  z-index: 50;
  user-select: none;
  -webkit-user-select: none;
}

.ny-outline__header {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 28%);
  color: var(--ny-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  user-select: none;
}

.ny-outline__list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
  color: var(--ny-text-secondary);
  font-size: 14px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ny-text-muted), transparent 56%) transparent;
}

.ny-outline__empty {
  color: var(--ny-text-muted);
  font-size: 12px;
  font-style: italic;
}

.ny-outline__item {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  padding: 8px 10px 8px calc(26px + var(--outline-indent, 0px));
  border-radius: 14px;
  color: inherit;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.42;
  cursor: default;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.ny-outline__item::before {
  content: "";
  position: absolute;
  left: calc(10px + var(--outline-indent, 0px));
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-text-muted), transparent 24%);
  transform: translateY(-50%);
}

.ny-outline__item[data-level="1"] {
  padding-left: 16px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ny-text-primary);
}

.ny-outline__item[data-level="1"]:not(:first-child) {
  margin-top: 8px;
}

.ny-outline__item[data-level="1"]::before {
  left: 0;
  width: 4px;
  height: 18px;
  border-radius: 999px;
  background: var(--ny-accent);
}

.ny-outline__item[data-level="2"] {
  font-weight: 620;
  color: var(--ny-text-primary);
}

.ny-outline__item[data-level="2"]:not(:first-child) {
  margin-top: 4px;
}

.ny-outline__item[data-level="3"] {
  font-size: 13.5px;
}

.ny-outline__item[data-level="4"],
.ny-outline__item[data-level="5"],
.ny-outline__item[data-level="6"] {
  font-size: 13px;
  color: var(--ny-text-muted);
}

.ny-outline__item:hover {
  background: color-mix(in srgb, var(--ny-surface-elevated), var(--ny-accent) 7%);
  color: var(--ny-text-primary);
}

.ny-outline__item.is-active {
  background: color-mix(in srgb, var(--ny-surface-elevated), var(--ny-accent) 12%);
  color: var(--ny-text-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ny-accent), transparent 72%);
}

.ny-outline__item.is-active::before {
  background: var(--ny-accent);
}
`;

/** Pause after the last document change before the list is refreshed. */
const RENDER_DELAY_MS = 150;

export class OutlinePanel {
  private elPanel: HTMLElement;
  private elList: HTMLElement;
  private isVisible = false;
  private activeHeadingId: string | null = null;
  /** Identity of the rendered headings; equal headings keep the DOM. */
  private renderedSignature: string | null = null;
  private renderTimer: number | null = null;
  private readonly unsubscribe: () => void;
  private releaseEscape: (() => void) | null = null;

  constructor(private editor: NyaEditor) {
    ensureStyle('outline-panel', outlineStyles);

    this.elPanel = document.createElement('div');
    this.elPanel.className = 'ny-outline';
    this.elPanel.style.opacity = '0';
    this.elPanel.style.pointerEvents = 'none';
    this.elPanel.style.transform = 'translateY(-6px)';

    const header = document.createElement('div');
    header.className = 'ny-outline__header';
    header.textContent = 'Outline';
    header.setAttribute('data-i18n', 'outline.title');

    this.elList = document.createElement('div');
    this.elList.className = 'ny-outline__list';

    this.elPanel.appendChild(header);
    this.elPanel.appendChild(this.elList);
    document.body.appendChild(this.elPanel);
    translateDOM(this.elPanel);

    // Toggling is a global shortcut (see features/shortcut-controller.ts).
    this.unsubscribe = editor.onDocChanged(() => this.scheduleRender());
  }

  destroy() {
    this.releaseEscape?.();
    this.unsubscribe();
    if (this.renderTimer != null) window.clearTimeout(this.renderTimer);
    this.elPanel.remove();
  }

  /** A burst of keystrokes is rendered once, after it ends. */
  private scheduleRender() {
    if (!this.isVisible || this.renderTimer != null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.renderOutline();
    }, RENDER_DELAY_MS);
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.releaseEscape = pushEscapeLayer({ dismiss: () => this.hide() });
    this.elPanel.style.opacity = '1';
    this.elPanel.style.pointerEvents = 'auto';
    this.elPanel.style.transform = 'translateY(0)';
    this.renderOutline();
  }

  hide() {
    this.isVisible = false;
    this.releaseEscape?.();
    this.releaseEscape = null;
    this.elPanel.style.opacity = '0';
    this.elPanel.style.pointerEvents = 'none';
    this.elPanel.style.transform = 'translateY(-6px)';
  }

  /**
   * Rebuild the list only when the headings differ from what is shown, and
   * keep the scroll position when they do; a rebuild on every change would
   * yank the list back to the top while the user is reading it.
   */
  private renderOutline() {
    const items = this.editor.getOutline();
    const signature = items
      .map((item) => `${item.level}\u0000${item.id}\u0000${item.text}`)
      .join('\n');
    if (signature === this.renderedSignature) return;
    this.renderedSignature = signature;

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

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'ny-outline__item';
      el.dataset.level = String(item.level);
      el.dataset.id = item.id;
      el.style.setProperty(
        '--outline-indent',
        `${Math.max(0, item.level - 2) * 14}px`
      );
      el.textContent = item.text;
      el.title = item.text;
      if (item.id === this.activeHeadingId) {
        el.classList.add('is-active');
      }

      el.addEventListener('click', () => {
        this.setActive(item.id);
        this.editor.scrollToHeading(item.id);
      });

      this.elList.appendChild(el);
    }
    this.elList.scrollTop = scrollTop;
  }

  private setActive(id: string) {
    this.activeHeadingId = id;
    for (const el of this.elList.children) {
      el.classList.toggle('is-active', (el as HTMLElement).dataset.id === id);
    }
  }
}
