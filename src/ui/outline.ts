import { NyaEditor } from '../editor/editor';
import { ensureStyle } from '../style/register';

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

export class OutlinePanel {
  private elPanel: HTMLElement;
  private elList: HTMLElement;
  private isVisible = false;
  private activeHeadingId: string | null = null;

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

    this.elList = document.createElement('div');
    this.elList.className = 'ny-outline__list';

    this.elPanel.appendChild(header);
    this.elPanel.appendChild(this.elList);
    document.body.appendChild(this.elPanel);

    this.setupListeners();
  }

  private setupListeners() {
    window.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + Shift + O
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyO') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    // Update outline periodically when visible
    setInterval(() => {
      if (this.isVisible) {
        this.renderOutline();
      }
    }, 1000);
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  show() {
    this.isVisible = true;
    this.elPanel.style.opacity = '1';
    this.elPanel.style.pointerEvents = 'auto';
    this.elPanel.style.transform = 'translateY(0)';
    this.renderOutline();
  }

  hide() {
    this.isVisible = false;
    this.elPanel.style.opacity = '0';
    this.elPanel.style.pointerEvents = 'none';
    this.elPanel.style.transform = 'translateY(-6px)';
  }

  private renderOutline() {
    const items = this.editor.getOutline();
    this.elList.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ny-outline__empty';
      empty.textContent = 'No headings found';
      this.elList.appendChild(empty);
      return;
    }

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'ny-outline__item';
      el.dataset.level = String(item.level);
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
        this.activeHeadingId = item.id;
        this.renderOutline();
        this.editor.scrollToHeading(item.id);
      });

      this.elList.appendChild(el);
    }
  }
}
