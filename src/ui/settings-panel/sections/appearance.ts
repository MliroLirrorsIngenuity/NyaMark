import { getPlatform } from '../../../platform/detect';
import {
  type AppearanceSettings,
  type ThemePreference,
  previewGlassOpacity,
  sanitizeAppearanceSettings,
} from '../../../state/settings';
import { renderSelect } from '../select';

const THEMES: { value: ThemePreference; label: string; i18n: string }[] = [
  {
    value: 'auto',
    label: 'Follow system',
    i18n: 'settings.appearance.themeAuto',
  },
  { value: 'light', label: 'Light', i18n: 'settings.appearance.themeLight' },
  { value: 'dark', label: 'Dark', i18n: 'settings.appearance.themeDark' },
];

export function renderAppearanceSection(
  current: AppearanceSettings,
  onChange: (next: AppearanceSettings, mode: 'input' | 'commit') => void
): HTMLElement {
  const showTransparency = getPlatform() !== 'linux';
  // macOS frosts with the system's material, which looks the same under any
  // wash of the page's colour; Windows' glass takes the wash it is given.
  const showOpacity = getPlatform() === 'windows';
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.appearance.title">Appearance</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.theme">Theme</span>
        <div class="ny-settings__select" data-key="theme"></div>
      </label>
    </div>
    ${
      showTransparency
        ? `
    <div class="ny-settings__row"${showOpacity ? '' : ' style="margin-bottom: 20px;"'}>
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="windowTransparency" />
        <span data-i18n="settings.appearance.windowTransparency">Enable frosted glass effect</span>
      </label>
    </div>
    ${
      showOpacity
        ? `
    <div class="ny-settings__row" style="margin-bottom: 20px;">
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.windowOpacity">Opacity</span>
        <span class="ny-settings__range">
          <input type="range" min="0" max="100" step="1" data-key="windowOpacity" />
          <output></output>
        </span>
      </label>
    </div>
    `
        : ''
    }
    `
        : ''
    }
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.fontSize">Font size</span>
        <input type="number" min="11" max="22" step="1" data-key="fontSize" />
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.lineHeight">Line height</span>
        <input type="number" min="1.2" max="2.2" step="any" data-key="lineHeight" />
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.readableWidth">Readable width (px)</span>
        <input type="number" min="520" max="1100" step="10" data-key="readableMaxWidth" />
      </label>
    </div>
  `;

  const themeSelect = section.querySelector<HTMLElement>(
    '.ny-settings__select[data-key="theme"]'
  );
  if (themeSelect) {
    renderSelect(themeSelect, THEMES, current.theme, (value) => {
      const next = sanitizeAppearanceSettings({
        ...current,
        theme: value as ThemePreference,
      });
      onChange(next, 'commit');
      Object.assign(current, next);
    });
  }

  const inputs = section.querySelectorAll<HTMLInputElement>('input[data-key]');
  for (const input of inputs) {
    const key = input.dataset.key as keyof AppearanceSettings;
    const field = input.closest('.ny-settings__field') as HTMLElement | null;
    const isCheckbox = input.type === 'checkbox';

    let hint: HTMLElement | null = null;
    if (!isCheckbox) {
      hint = document.createElement('span');
      hint.className = 'ny-settings__field-hint';
      field?.appendChild(hint);
      input.value = String(current[key]);
    } else {
      input.checked = Boolean(current[key]);
    }

    const syncValidity = () => {
      if (isCheckbox) return;
      const invalid = Boolean(input.value) && !input.validity.valid;
      field?.toggleAttribute('data-invalid', invalid);
      if (!invalid) {
        if (hint) hint.textContent = '';
        return;
      }
      if (hint) hint.textContent = `${input.min} - ${input.max}`;
    };

    const commit = (raw: number | boolean) => {
      const next = sanitizeAppearanceSettings({ ...current, [key]: raw });
      if (isCheckbox) {
        input.checked = Boolean(next[key]);
      } else {
        input.value = String(next[key]);
      }
      onChange(next, 'commit');
      Object.assign(current, next);
      syncValidity();
    };

    input.addEventListener('input', () => {
      syncValidity();
      if (isCheckbox) {
        const next = sanitizeAppearanceSettings({
          ...current,
          [key]: input.checked,
        });
        onChange(next, 'input');
        return;
      }
      if (!input.value || !input.validity.valid) return;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const next = sanitizeAppearanceSettings({ ...current, [key]: raw });
      onChange(next, 'input');
    });

    input.addEventListener('change', () => {
      if (isCheckbox) {
        commit(input.checked);
        return;
      }
      if (!input.value || !input.validity.valid) {
        input.value = String(current[key]);
        syncValidity();
        return;
      }
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) {
        input.value = String(current[key]);
        syncValidity();
        return;
      }
      commit(raw);
    });

    syncValidity();
  }

  const frosted = section.querySelector<HTMLInputElement>(
    'input[data-key="windowTransparency"]'
  );
  const opacity = section.querySelector<HTMLInputElement>(
    'input[data-key="windowOpacity"]'
  );
  const shown = section.querySelector('.ny-settings__range output');
  if (frosted && opacity && shown) {
    const show = () => {
      const { min, max, value } = opacity;
      const fill =
        ((Number(value) - Number(min)) / (Number(max) - Number(min))) * 100;
      opacity.style.setProperty('--ny-range-fill', `${fill}%`);
      shown.textContent = `${value}%`;
      opacity.disabled = !frosted.checked;
    };
    opacity.addEventListener('input', () => {
      show();
      previewGlassOpacity(Number(opacity.value));
    });
    opacity.addEventListener('change', show);
    frosted.addEventListener('change', show);
    show();
  }

  return section;
}
