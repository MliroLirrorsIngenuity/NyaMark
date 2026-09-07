export type SelectOption = {
  value: string;
  label: string;
  /** Translation key for the label; the label itself is the fallback. */
  i18n?: string;
};

/**
 * The dropdown the settings dialog uses in place of a native `<select>`
 * (styled in `panel.ts`). Renders into `host`, which must carry the
 * `ny-settings__select` class.
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

  host.innerHTML = `
    <button type="button" class="ny-settings__select-trigger">
      <span class="ny-settings__select-value"${i18nAttr(current)}>${current.label}</span>
      <svg class="ny-settings__select-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 8 4 4 4-4"/>
      </svg>
    </button>
    <div class="ny-settings__select-menu" hidden>
      ${options
        .map(
          (option) => `
        <button type="button" class="ny-settings__select-option ${option.value === current.value ? 'is-selected' : ''}" data-value="${option.value}"${i18nAttr(option)}>
          ${option.label}
        </button>
      `
        )
        .join('')}
    </div>
  `;

  const trigger = host.querySelector<HTMLElement>(
    '.ny-settings__select-trigger'
  );
  const menu = host.querySelector<HTMLElement>('.ny-settings__select-menu');
  const valueDisplay = host.querySelector<HTMLElement>(
    '.ny-settings__select-value'
  );
  const buttons = host.querySelectorAll<HTMLElement>(
    '.ny-settings__select-option'
  );
  if (!trigger || !menu || !valueDisplay) return;

  let selected = current.value;

  const closeOnOutsideClick = (event: MouseEvent) => {
    if (!host.contains(event.target as Node)) close();
  };
  const close = () => {
    host.classList.remove('is-open');
    menu.hidden = true;
    document.removeEventListener('click', closeOnOutsideClick);
  };
  const open = () => {
    host.classList.add('is-open');
    menu.hidden = false;
    document.addEventListener('click', closeOnOutsideClick);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (host.classList.contains('is-open')) close();
    else open();
  });

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = button.dataset.value;
      if (next && next !== selected) {
        selected = next;
        buttons.forEach((other) => other.classList.remove('is-selected'));
        button.classList.add('is-selected');
        valueDisplay.textContent = button.textContent?.trim() || '';
        // The option text is already translated; the value span must not be
        // re-translated to its old key on the next `translateDOM` pass.
        if (button.dataset.i18n)
          valueDisplay.dataset.i18n = button.dataset.i18n;
        else delete valueDisplay.dataset.i18n;
        onSelect(next);
      }
      close();
    });
  });
}
