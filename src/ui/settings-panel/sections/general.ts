import { type GeneralSettings } from '../../../state/settings';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文 (Simplified Chinese)' },
  { value: 'zh-TW', label: '繁體中文 (Traditional Chinese)' }
];

export function renderGeneralSection(
  current: GeneralSettings,
  onChange: (next: GeneralSettings) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  
  const currentLang = LANGUAGES.find(l => l.value === current.language) || LANGUAGES[0];

  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.general.title">General</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.general.language">Language</span>
        <div class="ny-settings__select" data-key="language">
          <button type="button" class="ny-settings__select-trigger">
            <span class="ny-settings__select-value" ${currentLang.value === 'auto' ? 'data-i18n="settings.general.autoLabel"' : ''}>${currentLang.label}</span>
            <svg class="ny-settings__select-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 8 4 4 4-4"/>
            </svg>
          </button>
          <div class="ny-settings__select-menu" hidden>
            ${LANGUAGES.map(lang => `
              <button type="button" class="ny-settings__select-option ${lang.value === current.language ? 'is-selected' : ''}" data-value="${lang.value}">
                ${lang.label}
              </button>
            `).join('')}
          </div>
        </div>
      </label>
    </div>
  `;

  const selectContainer = section.querySelector('.ny-settings__select');
  const trigger = selectContainer?.querySelector('.ny-settings__select-trigger');
  const menu = selectContainer?.querySelector('.ny-settings__select-menu');
  const valueDisplay = selectContainer?.querySelector('.ny-settings__select-value');
  const options = selectContainer?.querySelectorAll('.ny-settings__select-option');

  if (selectContainer && trigger && menu && valueDisplay && options) {
    const toggleMenu = () => {
      const isOpen = selectContainer.classList.contains('is-open');
      if (isOpen) {
        selectContainer.classList.remove('is-open');
        menu.setAttribute('hidden', '');
      } else {
        selectContainer.classList.add('is-open');
        menu.removeAttribute('hidden');
      }
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = option.getAttribute('data-value');
        if (value && value !== current.language) {
          options.forEach(o => o.classList.remove('is-selected'));
          option.classList.add('is-selected');
          valueDisplay.textContent = option.textContent?.trim() || '';
          onChange({ ...current, language: value });
          current.language = value;
        }
        toggleMenu();
      });
    });

    document.addEventListener('click', (e) => {
      if (selectContainer.classList.contains('is-open') && !selectContainer.contains(e.target as Node)) {
        selectContainer.classList.remove('is-open');
        menu.setAttribute('hidden', '');
      }
    });
  }

  return section;
}