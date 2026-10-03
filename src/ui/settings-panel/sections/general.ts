import { currentVersion } from '../../../bridge/ipc/updates';
import { i18next } from '../../../i18n';
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

type UpdateActions = {
  /** Resolves once the answer has been shown. */
  checkForUpdates: () => Promise<void>;
};

export function renderGeneralSection(
  current: GeneralSettings,
  onChange: (next: GeneralSettings) => void,
  updates?: UpdateActions
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

  if (updates) section.append(renderVersionRow(updates));
  return section;
}

/** The running version, and a check for a newer one. */
function renderVersionRow(updates: UpdateActions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ny-settings__row';
  row.innerHTML = `
    <div class="ny-settings__field">
      <span data-i18n="settings.general.version">Version</span>
      <div class="ny-settings__version">
        <span class="ny-settings__version-number"></span>
        <button type="button" class="ny-settings__version-button" data-i18n="settings.general.checkUpdates">Check for Updates</button>
      </div>
    </div>
  `;
  const number = row.querySelector<HTMLElement>('.ny-settings__version-number');
  const button = row.querySelector<HTMLButtonElement>(
    '.ny-settings__version-button'
  );
  void currentVersion()
    .then((version) => {
      if (number) number.textContent = version;
    })
    .catch(console.error);
  button?.addEventListener('click', async () => {
    button.disabled = true;
    button.removeAttribute('data-i18n');
    button.textContent = i18next.t('settings.general.checkingUpdates');
    try {
      await updates.checkForUpdates();
    } finally {
      button.disabled = false;
      button.setAttribute('data-i18n', 'settings.general.checkUpdates');
      button.textContent = i18next.t('settings.general.checkUpdates');
    }
  });
  return row;
}
