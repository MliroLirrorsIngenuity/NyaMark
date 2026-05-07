import {
  getSettings,
  saveSettings,
  resetSettings,
  type Settings,
} from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { renderAppearanceSection } from './sections/appearance';
import { renderSaveSection } from './sections/save-policy';
import { renderAttachmentsSection } from './sections/attachments';

const styles = `
.ny-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ny-bg-primary), transparent 26%);
  backdrop-filter: blur(10px) saturate(1.08);
  -webkit-backdrop-filter: blur(10px) saturate(1.08);
}

.ny-settings-overlay[hidden] {
  display: none;
}

.ny-settings-dialog {
  width: min(640px, calc(100vw - 40px));
  max-height: calc(100vh - 80px);
  display: grid;
  grid-template-rows: auto 1fr auto;
  padding: 22px 22px 18px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 24px;
  background: var(--ny-surface-ghost);
  box-shadow: var(--ny-shadow-float);
  color: var(--ny-text-primary);
  user-select: none;
  -webkit-user-select: none;
}

.ny-settings-dialog h3 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
}

.ny-settings-dialog__subtitle {
  margin: 0 0 12px;
  color: var(--ny-text-secondary);
  font-size: 13px;
}

.ny-settings-dialog__body {
  overflow: auto;
  padding-right: 2px;
}

.ny-settings__section {
  padding: 14px 0;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 32%);
}
.ny-settings__section:first-child {
  border-top: none;
}

.ny-settings__section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ny-text-primary);
  text-transform: uppercase;
}

.ny-settings__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin-bottom: 8px;
}

.ny-settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ny-text-secondary);
  flex: 1 1 160px;
  min-width: 140px;
}

.ny-settings__field--checkbox {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
}

.ny-settings__field input[type="number"] {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-primary);
  font: inherit;
}

.ny-settings__fieldset {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 28%);
  border-radius: 14px;
  padding: 12px 14px;
  margin: 0;
}
.ny-settings__fieldset legend {
  padding: 0 6px;
  font-size: 12px;
  color: var(--ny-text-secondary);
}

.ny-settings__options {
  display: grid;
  gap: 8px;
}

.ny-settings__option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 22%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 28%);
}
.ny-settings__option input[type="radio"] { margin-top: 3px; }
.ny-settings__option strong {
  display: block;
  margin-bottom: 2px;
  font-size: 13px;
  color: var(--ny-text-primary);
}
.ny-settings__option span span {
  display: block;
  color: var(--ny-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.ny-settings-dialog__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 36%);
}

.ny-settings-dialog__button {
  min-width: 88px;
  padding: 9px 14px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 8%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 12%);
  color: var(--ny-text-primary);
  font: inherit;
  cursor: default;
}

.ny-settings-dialog__button--primary {
  background: color-mix(in srgb, var(--ny-accent), var(--ny-surface-elevated) 14%);
}

.ny-settings-dialog__button:hover {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 36%);
}
`;

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;

  constructor() {
    ensureStyle('ny-settings-panel', styles);
  }

  open() {
    if (this.overlay) {
      this.overlay.hidden = false;
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ny-settings-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;

    let working: Settings = structuredClone(getSettings());

    const dialog = document.createElement('div');
    dialog.className = 'ny-settings-dialog';
    dialog.innerHTML = `
      <header>
        <h3>Settings</h3>
        <p class="ny-settings-dialog__subtitle">Personalise the editor without leaving the document.</p>
      </header>
    `;

    const body = document.createElement('div');
    body.className = 'ny-settings-dialog__body';

    const appearance = renderAppearanceSection(working.appearance, (next) => {
      working = { ...working, appearance: next };
    });
    const save = renderSaveSection(working.save, (next) => {
      working = { ...working, save: next };
    });
    const attachments = renderAttachmentsSection(working.attachments, (next) => {
      working = { ...working, attachments: next };
    });

    body.append(appearance, save, attachments);
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'ny-settings-dialog__actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'ny-settings-dialog__button';
    reset.textContent = 'Reset to defaults';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '10px';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ny-settings-dialog__button';
    cancel.textContent = 'Cancel';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ny-settings-dialog__button ny-settings-dialog__button--primary';
    ok.textContent = 'OK';

    buttons.append(cancel, ok);
    actions.append(reset, buttons);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    const close = () => {
      overlay.remove();
      this.overlay = null;
      document.removeEventListener('keydown', onKey);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    cancel.addEventListener('click', close);
    ok.addEventListener('click', async () => {
      await saveSettings(working);
      close();
    });
    reset.addEventListener('click', async () => {
      await resetSettings();
      close();
    });
  }
}
