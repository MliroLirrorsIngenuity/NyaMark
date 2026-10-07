import { i18next } from '../../i18n';
import {
  type AiEffort,
  type AiSettings,
  modelLabel,
} from '../../state/ai-settings';
import { pushEscapeLayer } from '../../ui/escape-layers';
import { defaultEffort, effortLevels } from '../providers/effort';
import { ICONS } from './icons';

const levelName = (effort: AiEffort) => i18next.t(`ai.effort.levels.${effort}`);

/**
 * How hard the chat model thinks, kept with the model. Shown only for a
 * model that reasons.
 */
export class EffortMenu {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private model = '';
  private levels: readonly AiEffort[] = [];
  /** The level chosen, null for the service's own. */
  private chosen: AiEffort | null = null;
  /** The service's own level, when it says which. */
  private fallback: AiEffort | null = null;
  private releaseEscape: (() => void) | null = null;

  constructor(private readonly choose: (effort: AiEffort | null) => void) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__pick ny-ai__effort';
    this.element.hidden = true;

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
  }

  update(ai: AiSettings) {
    const ref = ai.chatModel;
    const provider = ref && ai.providers.find((p) => p.id === ref.provider);
    const model = provider?.models.find((m) => m.id === ref?.model);
    this.levels = provider && model ? effortLevels(provider, model) : [];
    this.model = model ? modelLabel(model) : '';
    this.chosen =
      model?.effort && this.levels.includes(model.effort) ? model.effort : null;
    this.fallback = provider && model ? defaultEffort(provider, model) : null;
    this.element.hidden = this.levels.length === 0;
    if (this.element.hidden) this.setOpen(false);
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
    const shown = this.chosen ?? this.fallback;
    const label = shown ? levelName(shown) : i18next.t('ai.effort.default');
    this.button.innerHTML = ICONS.bulb;
    const name = document.createElement('span');
    name.className = 'ny-ai__pick-name';
    name.textContent = label;
    this.button.append(name);
    this.button.insertAdjacentHTML('beforeend', ICONS.chevron);
    this.button.title = i18next.t('ai.effort.current', { level: label });
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
    const group = document.createElement('div');
    group.className = 'ny-ai-menu__group';
    group.textContent = i18next.t('ai.effort.title', { model: this.model });
    const items = [null, ...this.levels].map((effort) => {
      const checked = effort === this.chosen;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ny-ai-menu__item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(checked));
      const name = document.createElement('span');
      name.textContent = effort
        ? levelName(effort)
        : this.fallback
          ? i18next.t('ai.effort.defaultIs', {
              level: levelName(this.fallback),
            })
          : i18next.t('ai.effort.default');
      const mark = document.createElement('span');
      mark.className = 'ny-ai-menu__check';
      mark.textContent = checked ? '✓' : '';
      item.append(name, mark);
      item.addEventListener('click', () => {
        this.setOpen(false);
        if (!checked) this.choose(effort);
      });
      return item;
    });
    this.menu.replaceChildren(group, ...items);
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
