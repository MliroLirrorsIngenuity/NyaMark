import type { NyaEditor } from '../editor/editor';
import { i18next } from '../i18n';
import { translateDOM } from '../i18n/dom';
import { ensureStyle } from '../style/register';
import { pushEscapeLayer } from './escape-layers';
import { forInputMethod } from './ime';

/**
 * Boxes in the page that close on Escape themselves: one pressed in them
 * closes them, and the find bar stays. It closed the find bar instead.
 */
const OWN_ESCAPE =
  '.milkdown-latex-inline-edit, .ny-html-editor, .milkdown-link-edit';

const searchStyles = `
.ny-search {
  position: fixed;
  top: 48px;
  right: 32px;
  z-index: var(--ny-layer-floating-panel);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 12px;
  background: var(--ny-surface-ghost);
  box-shadow: var(--ny-shadow-float);
  backdrop-filter: blur(20px) saturate(1.1);
  -webkit-backdrop-filter: blur(20px) saturate(1.1);
  animation: ny-search-in 0.15s ease;
}

.ny-search[hidden] {
  display: none;
}

@keyframes ny-search-in {
  from {
    opacity: 0;
  }
}

.ny-search__input {
  width: 192px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--ny-text-primary);
  font-size: 14px;
  outline: none;
}

.ny-search__input::placeholder {
  color: var(--ny-text-muted);
}

/* Room kept for the longest count, so the field typed into stays put: the
   panel grew to the left with each count, from none to "无结果", and the
   digits of PingFang, which the count falls back to, are not all one width. */
.ny-search__count {
  min-width: 64px;
  color: var(--ny-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.ny-search__button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ny-text-muted);
  cursor: default;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.ny-search__button:hover {
  background: color-mix(in srgb, var(--ny-surface-elevated), var(--ny-accent) 8%);
  color: var(--ny-text-primary);
}

.ny-search__button--close {
  margin-left: 4px;
}

.ny-search__button--close:hover {
  color: #ef4444;
}
`;

export class SearchPanel {
  private readonly elPanel: HTMLElement;
  private readonly elInput: HTMLInputElement;
  private readonly elCount: HTMLElement;
  private releaseEscape: (() => void) | null = null;
  private stopWatchingDoc: (() => void) | null = null;
  private stopFollowingBar: (() => void) | null = null;

  constructor(private readonly getEditor: () => NyaEditor | null) {
    ensureStyle('search-panel', searchStyles);

    this.elPanel = document.createElement('div');
    this.elPanel.className = 'ny-search';
    this.elPanel.setAttribute('role', 'search');
    this.elPanel.hidden = true;

    this.elInput = document.createElement('input');
    this.elInput.type = 'text';
    this.elInput.placeholder = 'Find…';
    this.elInput.className = 'ny-search__input';
    this.elInput.setAttribute('data-i18n-placeholder', 'search.placeholder');
    this.elInput.setAttribute('aria-label', 'Find…');
    this.elInput.setAttribute('data-i18n-aria-label', 'search.placeholder');

    this.elCount = document.createElement('span');
    this.elCount.className = 'ny-search__count';
    this.elCount.setAttribute('aria-live', 'polite');

    const btnNext = document.createElement('button');
    btnNext.innerHTML = '↓';
    btnNext.className = 'ny-search__button';
    btnNext.type = 'button';
    btnNext.setAttribute('title', 'Next match');
    btnNext.setAttribute('data-i18n-title', 'search.next');
    btnNext.setAttribute('aria-label', 'Next match');
    btnNext.setAttribute('data-i18n-aria-label', 'search.next');

    const btnPrev = document.createElement('button');
    btnPrev.innerHTML = '↑';
    btnPrev.className = 'ny-search__button';
    btnPrev.type = 'button';
    btnPrev.setAttribute('title', 'Previous match');
    btnPrev.setAttribute('data-i18n-title', 'search.prev');
    btnPrev.setAttribute('aria-label', 'Previous match');
    btnPrev.setAttribute('data-i18n-aria-label', 'search.prev');

    const btnClose = document.createElement('button');
    btnClose.innerHTML = '✕';
    btnClose.className = 'ny-search__button ny-search__button--close';
    btnClose.type = 'button';
    btnClose.setAttribute('title', 'Close search');
    btnClose.setAttribute('data-i18n-title', 'search.close');
    btnClose.setAttribute('aria-label', 'Close search');
    btnClose.setAttribute('data-i18n-aria-label', 'search.close');

    this.elPanel.appendChild(this.elInput);
    this.elPanel.appendChild(this.elCount);
    this.elPanel.appendChild(btnPrev);
    this.elPanel.appendChild(btnNext);
    this.elPanel.appendChild(btnClose);
    document.body.appendChild(this.elPanel);

    translateDOM(this.elPanel);

    this.setupListeners(btnPrev, btnNext, btnClose);
  }

  private setupListeners(
    btnPrev: HTMLButtonElement,
    btnNext: HTMLButtonElement,
    btnClose: HTMLButtonElement
  ) {
    // Opening is a global shortcut (see features/shortcut-controller.ts).
    btnClose.addEventListener('click', () => this.hide());

    // Search as the query is typed; an IME commits its text on
    // compositionend, so the intermediate composition is skipped.
    this.elInput.addEventListener('input', (e) => {
      if (!(e as InputEvent).isComposing) this.search('first');
    });
    this.elInput.addEventListener('compositionend', () => this.search('first'));

    this.elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !forInputMethod(e)) {
        e.preventDefault();
        this.search(e.shiftKey ? 'prev' : 'next');
      }
    });

    btnNext.addEventListener('click', () => this.search('next'));
    btnPrev.addEventListener('click', () => this.search('prev'));
  }

  show() {
    // Text selected in the document is what to look for, as in other Mac
    // editors. From the field itself, the selection is the current match.
    const selected =
      document.activeElement === this.elInput
        ? ''
        : (this.getEditor()?.selectedLine() ?? '');
    if (selected) this.elInput.value = selected;
    if (this.elPanel.hidden) {
      this.releaseEscape = pushEscapeLayer({
        dismiss: () => this.hide(),
        takes: (event) => !(event.target as Element).closest?.(OWN_ESCAPE),
      });
      this.placeUnderFormatBar();
      this.elPanel.hidden = false;
      // Edits (or another file) change the matches under an open panel.
      this.stopWatchingDoc =
        this.getEditor()?.onDocChanged(() => this.renderCount()) ?? null;
      // Reopening with the previous query highlights it again.
      if (this.elInput.value) this.search('first');
    } else if (selected) {
      this.search('first');
    }
    this.elInput.focus();
    this.elInput.select();
  }

  /**
   * Hangs the panel under the formatting bar, flush with its right end. At a
   * fixed offset from the window it sat on the bar's right half, and on the
   * outline once that was docked. The bar narrows as the outline opens and
   * the window resizes, and the panel follows. Source mode has no bar.
   */
  private placeUnderFormatBar() {
    const bar = document.querySelector('.milkdown-top-bar');
    const place = () => {
      const box =
        bar && bar.getClientRects().length > 0
          ? bar.getBoundingClientRect()
          : null;
      this.elPanel.style.top = box ? `${Math.round(box.bottom + 8)}px` : '';
      this.elPanel.style.right = box
        ? `${Math.round(document.documentElement.clientWidth - box.right)}px`
        : '';
    };
    place();
    if (!bar) return;
    // A wide window centres a bar at its widest without resizing it.
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    window.addEventListener('resize', place);
    this.stopFollowingBar = () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }

  /** Closes the panel; the editor keeps the last match selected. */
  hide() {
    if (this.elPanel.hidden) return;
    this.elPanel.hidden = true;
    this.releaseEscape?.();
    this.releaseEscape = null;
    this.stopWatchingDoc?.();
    this.stopWatchingDoc = null;
    this.stopFollowingBar?.();
    this.stopFollowingBar = null;
    this.elCount.textContent = '';
    this.getEditor()?.endSearch();
  }

  private search(direction: 'first' | 'next' | 'prev') {
    this.getEditor()?.search(this.elInput.value, direction);
    this.renderCount();
  }

  private renderCount() {
    const editor = this.getEditor();
    if (!editor || !this.elInput.value) {
      this.elCount.textContent = '';
      return;
    }
    const { current, total } = editor.searchStatus();
    this.elCount.textContent =
      total === 0
        ? i18next.t('search.noResults')
        : i18next.t('search.count', { current, total });
  }
}
