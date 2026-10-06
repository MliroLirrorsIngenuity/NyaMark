import { i18next } from '../../i18n';
import type { AiEditMode } from '../../state/ai-settings';
import { pushEscapeLayer } from '../../ui/escape-layers';
import { ICONS } from './icons';

const MODES: Record<AiEditMode, { icon: string; label: string; note: string }> =
  {
    review: {
      icon: ICONS.eye,
      label: 'ai.edit.modeReview',
      note: 'ai.edit.modeReviewNote',
    },
    auto: {
      icon: ICONS.bolt,
      label: 'ai.edit.modeAuto',
      note: 'ai.edit.modeAutoNote',
    },
  };

/** Whether the assistant's edits wait to be accepted or go in at once. */
export class ModeMenu {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private mode: AiEditMode = 'review';
  private releaseEscape: (() => void) | null = null;

  constructor(private readonly choose: (mode: AiEditMode) => void) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__pick';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__pick-button';
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(this.menu.hidden);
    });

    this.menu = document.createElement('div');
    this.menu.className = 'ny-ai-menu ny-ai-menu--up';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.menu.addEventListener('keydown', this.onMenuKey);

    this.element.append(this.button, this.menu);
    this.drawButton();
  }

  update(mode: AiEditMode) {
    this.mode = mode;
    this.redraw();
  }

  /** Draws the labels again, as after the language changed. */
  redraw() {
    this.drawButton();
    if (!this.menu.hidden) this.renderMenu();
  }

  destroy() {
    this.setOpen(false);
  }

  private drawButton() {
    const mode = MODES[this.mode];
    const label = i18next.t(mode.label);
    this.button.innerHTML = mode.icon;
    const name = document.createElement('span');
    name.className = 'ny-ai__pick-name';
    name.textContent = label;
    this.button.append(name);
    this.button.insertAdjacentHTML('beforeend', ICONS.chevron);
    this.button.title = i18next.t(mode.note);
  }

  private setOpen(open: boolean) {
    if (open === !this.menu.hidden) return;
    this.menu.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      this.renderMenu();
      document.addEventListener('mousedown', this.onOutside, true);
      this.releaseEscape = pushEscapeLayer({
        dismiss: () => {
          this.setOpen(false);
          this.button.focus();
        },
      });
      this.menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    } else {
      document.removeEventListener('mousedown', this.onOutside, true);
      this.releaseEscape?.();
      this.releaseEscape = null;
    }
  }

  private renderMenu() {
    this.menu.replaceChildren();
    for (const mode of ['review', 'auto'] as const) {
      const text = MODES[mode];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ny-ai-menu__item ny-ai-menu__item--rich';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(mode === this.mode));
      const icon = document.createElement('span');
      icon.className = 'ny-ai-menu__icon';
      icon.innerHTML = text.icon;
      const body = document.createElement('span');
      body.className = 'ny-ai-menu__body';
      const label = document.createElement('span');
      label.className = 'ny-ai-menu__label';
      label.textContent = i18next.t(text.label);
      const note = document.createElement('span');
      note.className = 'ny-ai-menu__note';
      note.textContent = i18next.t(text.note);
      body.append(label, note);
      const mark = document.createElement('span');
      mark.className = 'ny-ai-menu__check';
      mark.textContent = mode === this.mode ? '✓' : '';
      item.append(icon, body, mark);
      item.addEventListener('click', () => {
        this.setOpen(false);
        if (mode !== this.mode) this.choose(mode);
      });
      this.menu.append(item);
    }
  }

  private onOutside = (event: MouseEvent) => {
    if (!this.element.contains(event.target as Node)) this.setOpen(false);
  };

  private onMenuKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [
      ...this.menu.querySelectorAll<HTMLElement>('.ny-ai-menu__item'),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };
}
