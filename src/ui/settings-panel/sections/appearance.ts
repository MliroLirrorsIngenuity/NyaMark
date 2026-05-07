import type { AppearanceSettings } from '../../../state/settings';

export function renderAppearanceSection(
  current: AppearanceSettings,
  onChange: (next: AppearanceSettings) => void
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
        <input type="number" min="1.2" max="2.2" step="0.05" data-key="lineHeight" />
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
    input.value = String(current[key]);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const next = { ...current, [key]: value } as AppearanceSettings;
      onChange(next);
      Object.assign(current, next);
    });
  });

  return section;
}
