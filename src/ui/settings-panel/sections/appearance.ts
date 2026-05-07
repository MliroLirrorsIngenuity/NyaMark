import {
  sanitizeAppearanceSettings,
  type AppearanceSettings,
} from '../../../state/settings';

export function renderAppearanceSection(
  current: AppearanceSettings,
  onChange: (next: AppearanceSettings, mode: 'input' | 'commit') => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title">Appearance</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field">
        <span>Font size</span>
        <input type="number" min="11" max="22" step="1" data-key="fontSize" />
      </label>
      <label class="ny-settings__field">
        <span>Line height</span>
        <input type="number" min="1.2" max="2.2" step="0.01" data-key="lineHeight" />
      </label>
      <label class="ny-settings__field">
        <span>Readable width (px)</span>
        <input type="number" min="520" max="1100" step="10" data-key="readableMaxWidth" />
      </label>
    </div>
  `;

  const inputs = section.querySelectorAll<HTMLInputElement>('input[data-key]');
  inputs.forEach((input) => {
    const key = input.dataset.key as keyof AppearanceSettings;
    const field = input.closest('.ny-settings__field') as HTMLElement | null;
    const hint = document.createElement('span');
    hint.className = 'ny-settings__field-hint';
    field?.appendChild(hint);
    input.value = String(current[key]);

    const syncValidity = () => {
      const invalid = Boolean(input.value) && !input.validity.valid;
      field?.toggleAttribute('data-invalid', invalid);
      if (!invalid) {
        hint.textContent = '';
        return;
      }
      hint.textContent = `${input.min} - ${input.max}`;
    };

    const commit = (raw: number) => {
      const next = sanitizeAppearanceSettings({ ...current, [key]: raw });
      input.value = String(next[key]);
      onChange(next, 'commit');
      Object.assign(current, next);
      syncValidity();
    };

    input.addEventListener('input', () => {
      syncValidity();
      if (!input.value || !input.validity.valid) return;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const next = sanitizeAppearanceSettings({ ...current, [key]: raw });
      onChange(next, 'input');
    });

    input.addEventListener('change', () => {
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
