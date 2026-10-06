import { pushEscapeLayer } from '../escape-layers';

export type SelectOption = {
  value: string;
  label: string;
  /** Translation key for the label; the label itself is the fallback. */
  i18n?: string;
};

let selectSequence = 0;
/**
 * Closes the dropdown that is open. Each trigger stops its click, so the
 * open dropdown never hears it as a click outside: opening another one
 * closes it through here.
 */
let closeOpenSelect: (() => void) | null = null;

/**
 * The dropdown the settings dialog uses in place of a native `<select>`
 * (styled in `panel.ts`). Renders into `host`, which must carry the
 * `ny-settings__select` class.
 *
 * Follows the select-only combobox pattern: the trigger announces a
 * listbox, arrow keys open it and move between options, Enter or Space
 * picks one, Escape and Tab close it.
 */
export function renderSelect(
  host: HTMLElement,
  options: SelectOption[],
  value: string,
  onSelect: (value: string) => void
) {
  const current =
    options.find((option) => option.value === value) ?? options[0];
  const i18nAttr = (option: SelectOption) =>
    option.i18n ? ` data-i18n="${option.i18n}"` : '';
  const menuId = `ny-select-${++selectSequence}`;

  host.innerHTML = `
    <button type="button" class="ny-settings__select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${menuId}">
      <span class="ny-settings__select-value"${i18nAttr(current)}>${current.label}</span>
      <svg class="ny-settings__select-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 8 4 4 4-4"/>
      </svg>
    </button>
    <div class="ny-settings__select-menu" id="${menuId}" role="listbox" hidden>
      ${options
        .map(
          (option) => `
        <button type="button" role="option" tabindex="-1" aria-selected="${option.value === current.value}" class="ny-settings__select-option ${option.value === current.value ? 'is-selected' : ''}" data-value="${option.value}"${i18nAttr(option)}>
          ${option.label}
        </button>
      `
        )
        .join('')}
    </div>
  `;

  const trigger = host.querySelector<HTMLButtonElement>(
    '.ny-settings__select-trigger'
  );
  const menu = host.querySelector<HTMLElement>('.ny-settings__select-menu');
  const valueDisplay = host.querySelector<HTMLElement>(
    '.ny-settings__select-value'
  );
  const buttons = Array.from(
    host.querySelectorAll<HTMLButtonElement>('.ny-settings__select-option')
  );
  if (!trigger || !menu || !valueDisplay) return;

  let selected = current.value;
  dropdown(host, trigger, menu, buttons, {
    first: () => buttons.find((button) => button.dataset.value === selected),
    pick: (button) => {
      const next = button.dataset.value;
      if (!next || next === selected) return;
      selected = next;
      for (const other of buttons) {
        const isSelected = other === button;
        other.classList.toggle('is-selected', isSelected);
        other.setAttribute('aria-selected', String(isSelected));
      }
      valueDisplay.textContent = button.textContent?.trim() || '';
      // The option text is already translated; the value span must not be
      // re-translated to its old key on the next `translateDOM` pass.
      if (button.dataset.i18n) valueDisplay.dataset.i18n = button.dataset.i18n;
      else delete valueDisplay.dataset.i18n;
      onSelect(next);
    },
  });
}

export type MenuItem = {
  value: string;
  label: string;
  /** Translation key for the label; the label itself is the fallback. */
  i18n?: string;
  /** Starts a group of its own, set off from the items above. */
  group?: boolean;
};

/**
 * A button that opens a menu of actions, in the select's look (styled in
 * `panel.ts`). Renders into `host`, which must carry the
 * `ny-settings__select` class.
 */
export function renderMenuButton(
  host: HTMLElement,
  label: { i18n: string; text: string },
  items: MenuItem[],
  onPick: (value: string) => void
) {
  const menuId = `ny-select-${++selectSequence}`;
  host.classList.add('ny-settings__select--menu');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ny-settings__select-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', menuId);
  trigger.innerHTML = `${PLUS}<span class="ny-settings__select-value"></span>${CHEVRON}`;
  const text = trigger.querySelector<HTMLElement>('.ny-settings__select-value');
  if (text) {
    text.textContent = label.text;
    text.dataset.i18n = label.i18n;
  }

  const menu = document.createElement('div');
  menu.className = 'ny-settings__select-menu';
  menu.id = menuId;
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (item.group && buttons.length > 0) {
      const line = document.createElement('div');
      line.className = 'ny-settings__select-separator';
      line.setAttribute('role', 'separator');
      menu.append(line);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ny-settings__select-option';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.dataset.value = item.value;
    button.textContent = item.label;
    if (item.i18n) button.dataset.i18n = item.i18n;
    buttons.push(button);
    menu.append(button);
  }
  host.replaceChildren(trigger, menu);

  dropdown(host, trigger, menu, buttons, {
    first: () => buttons[0],
    pick: (button) => {
      if (button.dataset.value) onPick(button.dataset.value);
    },
  });
}

const CHEVRON = `<svg class="ny-settings__select-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>`;

const PLUS = `<svg class="ny-settings__select-lead" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>`;

/**
 * Opens and closes `menu` under `trigger`: arrow keys open it and move
 * between its buttons, Enter or Space picks one, Escape and Tab close it,
 * as does a click anywhere else.
 */
function dropdown(
  host: HTMLElement,
  trigger: HTMLButtonElement,
  menu: HTMLElement,
  buttons: HTMLButtonElement[],
  how: {
    /** The button to focus as the menu opens. */
    first: () => HTMLButtonElement | undefined;
    pick: (button: HTMLButtonElement) => void;
  }
) {
  let releaseEscape: (() => void) | null = null;

  const closeOnOutsideClick = (event: MouseEvent) => {
    if (!host.contains(event.target as Node)) close(false);
  };
  const dismiss = () => close(false);
  const close = (refocus: boolean) => {
    if (menu.hidden) return;
    if (closeOpenSelect === dismiss) closeOpenSelect = null;
    host.classList.remove('is-open');
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeOnOutsideClick);
    releaseEscape?.();
    releaseEscape = null;
    if (refocus) trigger.focus();
  };
  const open = () => {
    if (!menu.hidden) return;
    closeOpenSelect?.();
    closeOpenSelect = dismiss;
    host.classList.add('is-open');
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', closeOnOutsideClick);
    releaseEscape = pushEscapeLayer({ dismiss: () => close(true) });
    flip();
    (how.first() ?? buttons[0])?.focus();
  };
  // Opens upward when the menu would run past the bottom of the scrolling
  // dialog body and there is more room above.
  const flip = () => {
    host.classList.remove('is-up');
    const bounds = host
      .closest('.ny-settings-dialog__body')
      ?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const anchor = trigger.getBoundingClientRect();
    const below = bounds.bottom - anchor.bottom;
    const above = anchor.top - bounds.top;
    const needed = menu.getBoundingClientRect().height + 6;
    host.classList.toggle('is-up', needed > below && above > below);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close(true);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });

  menu.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
    };
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(buttons.length - 1);
    else if (event.key === 'Tab') close(false);
  });

  for (const button of buttons) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      close(true);
      how.pick(button);
    });
  }
}
