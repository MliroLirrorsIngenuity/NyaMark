import { ensureStyle } from '../style/register';
import { translateDOM } from '../i18n/dom';

const searchStyles = `
.ny-search {
  position: fixed;
  top: 48px;
  right: 32px;
  z-index: 50;
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
  transition: opacity 0.15s ease;
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
  private elPanel: HTMLElement;
  private elInput: HTMLInputElement;
  private isVisible = false;

  constructor() {
    ensureStyle('search-panel', searchStyles);

    this.elPanel = document.createElement('div');
    this.elPanel.className = 'ny-search';
    this.elPanel.style.opacity = '0';
    this.elPanel.style.pointerEvents = 'none';

    this.elInput = document.createElement('input');
    this.elInput.type = 'text';
    this.elInput.placeholder = 'Find...';
    this.elInput.className = 'ny-search__input';
    this.elInput.setAttribute('data-i18n-placeholder', 'search.placeholder');

    const btnNext = document.createElement('button');
    btnNext.innerHTML = '↓';
    btnNext.className = 'ny-search__button';
    btnNext.type = 'button';
    btnNext.setAttribute('title', 'Next match');
    btnNext.setAttribute('data-i18n-title', 'search.next');

    const btnPrev = document.createElement('button');
    btnPrev.innerHTML = '↑';
    btnPrev.className = 'ny-search__button';
    btnPrev.type = 'button';
    btnPrev.setAttribute('title', 'Previous match');
    btnPrev.setAttribute('data-i18n-title', 'search.prev');

    const btnClose = document.createElement('button');
    btnClose.innerHTML = '✕';
    btnClose.className = 'ny-search__button ny-search__button--close';
    btnClose.type = 'button';
    btnClose.setAttribute('title', 'Close search');
    btnClose.setAttribute('data-i18n-title', 'search.close');

    this.elPanel.appendChild(this.elInput);
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
    window.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + F
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF') {
        e.preventDefault();
        this.show();
      }
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    btnClose.addEventListener('click', () => this.hide());

    this.elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.performSearch(e.shiftKey);
      }
    });

    btnNext.addEventListener('click', () => this.performSearch(false));
    btnPrev.addEventListener('click', () => this.performSearch(true));
  }

  show() {
    this.isVisible = true;
    this.elPanel.style.opacity = '1';
    this.elPanel.style.pointerEvents = 'auto';
    this.elInput.focus();
    this.elInput.select();
  }

  hide() {
    this.isVisible = false;
    this.elPanel.style.opacity = '0';
    this.elPanel.style.pointerEvents = 'none';
    // Clear selection
    window.getSelection()?.removeAllRanges();
  }

  private performSearch(backward: boolean) {
    const text = this.elInput.value;
    if (!text) return;

    // Basic native find for MVP (it handles highlighting and scrolling)
    // A robust Prosemirror implementation would be needed for a perfect Typora clone
    // but window.find provides instant value for v0.2
    const found = (window as any).find(
      text,
      false,
      backward,
      true,
      false,
      false,
      false
    );
    if (!found) {
      // If we reach the end/beginning, wrap around
      // window.find stops at document bounds if wrap is false, but we passed wrap=true
      // so it should wrap automatically
    }
  }
}
