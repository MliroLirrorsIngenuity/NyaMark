import { getPlatform } from '../../../platform/detect';
import {
  sanitizeAppearanceSettings,
  type AppearanceSettings,
} from '../../../state/settings';

export function renderAppearanceSection(
  current: AppearanceSettings,
  onChange: (next: AppearanceSettings, mode: 'input' | 'commit') => void
): HTMLElement {
  const showTransparency = getPlatform() !== 'linux';
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.appearance.title">Appearance</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.fontSize">Font size</span>
        <input type="number" min="11" max="22" step="1" data-key="fontSize" />
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.lineHeight">Line height</span>
        <input type="number" min="1.2" max="2.2" step="0.01" data-key="lineHeight" />
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.appearance.readableWidth">Readable width (px)</span>
        <input type="number" min="520" max="1100" step="10" data-key="readableMaxWidth" />
      </label>
      ${
        showTransparency
          ? `
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="windowTransparency" />
        <span data-i18n="settings.appearance.windowTransparency">Enable window transparency</span>
      </label>
      `
          : ''
      }
    </div>
  `;

  const inputs = section.querySelectorAll<HTMLInputElement>('input[data-key]');
  inputs.forEach((input) => {
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
  });

  return section;
}
