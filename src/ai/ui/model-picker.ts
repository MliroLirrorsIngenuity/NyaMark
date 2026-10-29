import { i18next } from '../../i18n';
import {
  type AiModelRef,
  type AiSettings,
  modelLabel,
} from '../../state/ai-settings';
import { pushEscapeLayer } from '../../ui/escape-layers';
import { ICONS } from './icons';

/** The models to choose from, by service, and the one the chat uses. */
export type ModelChoices = {
  /** The chosen model's name, or the ask to choose one. */
  label: string;
  /** The chosen model with its service; empty when none is chosen. */
  title: string;
  groups: Array<{
    name: string;
    models: Array<{ ref: AiModelRef; label: string; checked: boolean }>;
  }>;
};

export function modelChoices(ai: AiSettings): ModelChoices {
  const chosen = ai.chatModel;
  const provider = chosen && ai.providers.find((p) => p.id === chosen.provider);
  let label = i18next.t('ai.chooseModel');
  let title = '';
  if (chosen && provider) {
    const model = provider.models.find((m) => m.id === chosen.model);
    label = model ? modelLabel(model) : chosen.model;
    title = `${provider.name} · ${label}`;
  }
  const groups = ai.providers
    .filter((service) => service.models.length > 0)
    .map((service) => ({
      name: service.name,
      models: service.models.map((model) => ({
        ref: { provider: service.id, model: model.id },
        label: modelLabel(model),
        checked: chosen?.provider === service.id && chosen.model === model.id,
      })),
    }));
  return { label, title, groups };
}

/** The model the conversation talks to, from every connected service. */
export class ModelPicker {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLElement;
  private readonly menu: HTMLElement;
  private ai: AiSettings | null = null;
  private releaseEscape: (() => void) | null = null;

  constructor(
    private readonly actions: {
      choose: (ref: AiModelRef) => void;
      manage: () => void;
    }
  ) {
    this.element = document.createElement('div');
    this.element.className = 'ny-ai__pick ny-ai__model';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__pick-button';
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.label = document.createElement('span');
    this.label.className = 'ny-ai__pick-name';
    this.button.append(this.label);
    this.button.insertAdjacentHTML('beforeend', ICONS.chevron);
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
    this.ai = ai;
    const choices = modelChoices(ai);
    this.label.textContent = choices.label;
    this.button.title = choices.title;
    if (!this.menu.hidden) this.renderMenu();
  }

  destroy() {
    this.setOpen(false);
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
      const current =
        this.menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
        this.menu.querySelector<HTMLElement>('.ny-ai-menu__item');
      current?.focus();
      current?.scrollIntoView({ block: 'nearest' });
    } else {
      document.removeEventListener('mousedown', this.onOutside, true);
      this.releaseEscape?.();
      this.releaseEscape = null;
    }
  }

  private renderMenu() {
    const ai = this.ai;
    this.menu.replaceChildren();
    if (!ai) return;
    for (const service of modelChoices(ai).groups) {
      const group = document.createElement('div');
      group.className = 'ny-ai-menu__group';
      group.textContent = service.name;
      this.menu.append(group);
      for (const model of service.models) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ny-ai-menu__item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(model.checked));
        const name = document.createElement('span');
        name.textContent = model.label;
        item.title = `${service.name} · ${model.ref.model}`;
        const mark = document.createElement('span');
        mark.className = 'ny-ai-menu__check';
        mark.textContent = model.checked ? '✓' : '';
        item.append(name, mark);
        item.addEventListener('click', () => {
          this.setOpen(false);
          this.actions.choose(model.ref);
        });
        this.menu.append(item);
      }
    }
    if (this.menu.childElementCount > 0) {
      const divider = document.createElement('div');
      divider.className = 'ny-ai-menu__divider';
      this.menu.append(divider);
    }
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'ny-ai-menu__item';
    manage.setAttribute('role', 'menuitem');
    const text = document.createElement('span');
    text.textContent = i18next.t('ai.manageServices');
    manage.append(text);
    manage.addEventListener('click', () => {
      this.setOpen(false);
      this.actions.manage();
    });
    this.menu.append(manage);
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
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
  };
}
