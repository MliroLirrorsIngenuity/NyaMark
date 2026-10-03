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
    (
      buttons.find((button) => button.dataset.value === selected) ?? buttons[0]
    )?.focus();
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
      const next = button.dataset.value;
      if (next && next !== selected) {
        selected = next;
        for (const other of buttons) {
          const isSelected = other === button;
          other.classList.toggle('is-selected', isSelected);
          other.setAttribute('aria-selected', String(isSelected));
        }
        valueDisplay.textContent = button.textContent?.trim() || '';
        // The option text is already translated; the value span must not be
        // re-translated to its old key on the next `translateDOM` pass.
        if (button.dataset.i18n)
          valueDisplay.dataset.i18n = button.dataset.i18n;
        else delete valueDisplay.dataset.i18n;
        onSelect(next);
      }
      close(true);
    });
  }
}
