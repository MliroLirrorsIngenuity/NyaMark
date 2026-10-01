import type { GeneralSettings } from '../../../state/settings';
import { renderSelect } from '../select';

const LANGUAGES = [
  {
    value: 'auto',
    label: 'Auto (System Default)',
    i18n: 'settings.general.autoLabel',
  },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文 (Simplified Chinese)' },
  { value: 'zh-TW', label: '繁體中文 (Traditional Chinese)' },
];

export function renderGeneralSection(
  current: GeneralSettings,
  onChange: (next: GeneralSettings) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.general.title">General</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.general.language">Language</span>
        <div class="ny-settings__select" data-key="language"></div>
      </label>
    </div>
  `;

  const select = section.querySelector<HTMLElement>('.ny-settings__select');
  if (select) {
    renderSelect(select, LANGUAGES, current.language, (value) => {
      current.language = value;
      onChange({ ...current, language: value });
    });
  }

  return section;
}
