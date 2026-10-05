import { i18next } from '../../i18n';
import type { AiModelRef, AiSettings } from '../../state/ai-settings';
import { pushEscapeLayer } from '../../ui/escape-layers';
import { ICONS } from './icons';

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
    this.element.className = 'ny-ai__model';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ny-ai__model-button';
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.label = document.createElement('span');
    this.label.className = 'ny-ai__model-name';
    this.button.append(this.label);
    this.button.insertAdjacentHTML('beforeend', ICONS.chevron);
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(this.menu.hidden);
    });

    this.menu = document.createElement('div');
    this.menu.className = 'ny-ai-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.menu.addEventListener('keydown', this.onMenuKey);

    this.element.append(this.button, this.menu);
  }

  update(ai: AiSettings) {
    this.ai = ai;
    const ref = ai.chatModel;
    const provider = ref && ai.providers.find((p) => p.id === ref.provider);
    if (ref && provider) {
      this.label.textContent = ref.model;
      this.button.title = `${provider.name} · ${ref.model}`;
    } else {
      this.label.textContent = i18next.t('ai.chooseModel');
      this.button.title = '';
    }
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
    const chosen = ai.chatModel;
    for (const provider of ai.providers) {
      if (provider.models.length === 0) continue;
      const group = document.createElement('div');
      group.className = 'ny-ai-menu__group';
      group.textContent = provider.name;
      this.menu.append(group);
      for (const model of provider.models) {
        const checked =
          chosen?.provider === provider.id && chosen.model === model.id;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ny-ai-menu__item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(checked));
        const name = document.createElement('span');
        name.textContent = model.id;
        item.title = `${provider.name} · ${model.id}`;
        const mark = document.createElement('span');
        mark.className = 'ny-ai-menu__check';
        mark.textContent = checked ? '✓' : '';
        item.append(name, mark);
        item.addEventListener('click', () => {
          this.setOpen(false);
          this.actions.choose({ provider: provider.id, model: model.id });
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
