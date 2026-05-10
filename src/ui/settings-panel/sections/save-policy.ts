import type { SaveSettings } from '../../../state/settings';

export function renderSaveSection(
  current: SaveSettings,
  onChange: (next: SaveSettings) => void
): HTMLElement {
  const minuteMin = 1;
  const minuteMax = 60;
  const minuteStep = 1;
  const toMinutes = (valueMs: number) => Math.round(valueMs / 60000);
  const toMilliseconds = (valueMinutes: number) => valueMinutes * 60000;

  const section = document.createElement('section');
  section.className = 'ny-settings__section';
  section.innerHTML = `
    <h4 class="ny-settings__section-title" data-i18n="settings.save.title">Save</h4>
    <div class="ny-settings__row">
      <label class="ny-settings__field ny-settings__field--checkbox">
        <input type="checkbox" data-key="autoSave" />
        <span data-i18n="settings.save.autoSave">Auto-save while editing</span>
      </label>
      <label class="ny-settings__field">
        <span data-i18n="settings.save.autoSaveInterval">Auto-save interval (min)</span>
        <input type="number" min="${minuteMin}" max="${minuteMax}" step="${minuteStep}" data-key="autoSaveIntervalMs" />
      </label>
    </div>
  `;

  const checkbox = section.querySelector<HTMLInputElement>(
    'input[type="checkbox"][data-key="autoSave"]'
  );
  const interval = section.querySelector<HTMLInputElement>(
    'input[type="number"][data-key="autoSaveIntervalMs"]'
  );
  if (checkbox) {
    checkbox.checked = current.autoSave;
    checkbox.addEventListener('change', () => {
      const next = { ...current, autoSave: checkbox.checked };
      onChange(next);
      Object.assign(current, next);
    });
  }
  if (interval) {
    const field = interval.closest('.ny-settings__field') as HTMLElement | null;
    const hint = document.createElement('span');
    hint.className = 'ny-settings__field-hint';
    field?.appendChild(hint);
    interval.value = String(toMinutes(current.autoSaveIntervalMs));

    const syncValidity = () => {
      const invalid = Boolean(interval.value) && !interval.validity.valid;
      field?.toggleAttribute('data-invalid', invalid);
      hint.textContent = invalid ? `${interval.min} - ${interval.max}` : '';
    };

    const commit = (value: number) => {
      const next = { ...current, autoSaveIntervalMs: toMilliseconds(value) };
      onChange(next);
      Object.assign(current, next);
      interval.value = String(toMinutes(current.autoSaveIntervalMs));
      syncValidity();
    };

    interval.addEventListener('input', () => {
      syncValidity();
      if (!interval.value || !interval.validity.valid) return;
      const value = Number(interval.value);
      if (!Number.isFinite(value)) return;
      commit(value);
    });

    interval.addEventListener('change', () => {
      if (!interval.value || !interval.validity.valid) {
        interval.value = String(toMinutes(current.autoSaveIntervalMs));
        syncValidity();
        return;
      }
      const value = Number(interval.value);
      if (!Number.isFinite(value)) {
        interval.value = String(toMinutes(current.autoSaveIntervalMs));
        syncValidity();
        return;
      }
      commit(value);
    });

    syncValidity();
  }

  return section;
}
