import {
  getSettings,
  previewAppearance,
  saveSettings,
  resetSettings,
  type Settings,
} from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { renderGeneralSection } from './sections/general';
import { renderAppearanceSection } from './sections/appearance';
import { renderSaveSection } from './sections/save-policy';
import { renderAttachmentsSection } from './sections/attachments';
import { translateDOM } from '../../i18n/dom';
import { errorDialog } from '../../bridge/ipc/files';

const styles = `
.ny-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  background: rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(12px) saturate(1.05);
  -webkit-backdrop-filter: blur(12px) saturate(1.05);
  overflow-y: auto;
  animation: ny-settings-overlay-in 160ms ease-out;
}

.ny-settings-overlay::before,
.ny-settings-overlay::after {
  content: "";
  flex: 1;
  min-height: 48px;
}

.ny-settings-overlay.is-closing {
  pointer-events: none;
  animation: ny-settings-overlay-out 140ms ease-in forwards;
}

.ny-settings-dialog {
  width: min(680px, calc(100vw - 48px));
  max-height: min(720px, calc(100vh - 120px));
  flex-shrink: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  padding: 32px 32px 28px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 28px;
  background: var(--ny-surface-elevated);
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.22);
  color: var(--ny-text-primary);
  user-select: none;
  -webkit-user-select: none;
  transform-origin: center center;
  animation: ny-settings-dialog-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ny-settings-overlay.is-closing .ny-settings-dialog {
  animation: ny-settings-dialog-out 150ms cubic-bezier(0.4, 0, 1, 1) forwards;
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
  padding: 0 8px 0 6px;
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
  gap: 12px;
  flex: 0 1 auto;
  cursor: pointer;
}

.ny-settings__field--checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 34px;
  height: 20px;
  background: color-mix(in srgb, var(--ny-text-muted), transparent 82%);
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 60%);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  margin: 0;
}

.ny-settings__field--checkbox input[type="checkbox"]:checked {
  background: var(--ny-accent);
  border-color: var(--ny-accent);
}

.ny-settings__field--checkbox input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ny-settings__field--checkbox input[type="checkbox"]:checked::after {
  transform: translateX(14px);
}

.ny-settings__field--checkbox:hover input[type="checkbox"] {
  border-color: color-mix(in srgb, var(--ny-border-strong), transparent 20%);
}

.ny-settings__field--checkbox:hover input[type="checkbox"]:checked {
  filter: brightness(1.05);
}

.ny-settings__field input[type="number"] {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-primary);
  font: inherit;
}

.ny-settings__select {
  position: relative;
  width: 100%;
}

.ny-settings__select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 16%);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 32%);
  color: var(--ny-text-primary);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.ny-settings__select-trigger:hover {
  border-color: color-mix(in srgb, var(--ny-border-strong), transparent 28%);
}

.ny-settings__select-icon {
  width: 16px;
  height: 16px;
  color: var(--ny-text-secondary);
  transition: transform 150ms ease;
}

.ny-settings__select.is-open .ny-settings__select-icon {
  transform: rotate(180deg);
}

.ny-settings__select-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 150;
  padding: 6px;
  background: #ffffff;
  border: 1px solid var(--ny-border-strong);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:root[data-theme="dark"] .ny-settings__select-menu {
  background: #1a202c;
}

.ny-settings__select-menu[hidden] {
  display: none;
}

.ny-settings__select-option {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.ny-settings__select-option:hover {
  background: color-mix(in srgb, var(--ny-border-strong), transparent 60%);
}

.ny-settings__select-option.is-selected {
  background: color-mix(in srgb, var(--ny-accent), transparent 80%);
  color: var(--ny-accent);
}

.ny-settings__field input[type="number"]:invalid,
.ny-settings__field[data-invalid="true"] input[type="number"] {
  border-color: color-mix(in srgb, #d46a6a, var(--ny-border-strong) 26%);
  box-shadow: 0 0 0 3px color-mix(in srgb, #d46a6a, transparent 82%);
}

.ny-settings__field-hint {
  min-height: 16px;
  font-size: 11.5px;
  line-height: 1.35;
  color: #c55f5f;
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

.ny-settings__option input[type="radio"] {
  margin-top: 3px;
}

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

.ny-settings-dialog__button--danger {
  border-color: color-mix(in srgb, #cf5a5a, var(--ny-border-strong) 18%);
  background: color-mix(in srgb, #cf5a5a, var(--ny-surface-elevated) 86%);
  color: #a73d3d;
}

.ny-settings-dialog__button:hover {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 36%);
}

.ny-settings-dialog__button--danger:hover {
  border-color: color-mix(in srgb, #cf5a5a, transparent 24%);
}

.ny-settings-dialog__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ny-settings-confirm {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-radius: 24px;
  background: color-mix(in srgb, var(--ny-bg-primary), transparent 36%);
  backdrop-filter: blur(8px) saturate(1.04);
  -webkit-backdrop-filter: blur(8px) saturate(1.04);
  animation: ny-settings-overlay-in 140ms ease-out;
}

.ny-settings-confirm.is-closing {
  pointer-events: none;
  animation: ny-settings-overlay-out 120ms ease-in forwards;
}

.ny-settings-confirm__panel {
  width: min(360px, calc(100vw - 96px));
  padding: 18px 18px 16px;
  border: 1px solid color-mix(in srgb, #cf5a5a, var(--ny-border-strong) 36%);
  border-radius: 18px;
  background: var(--ny-surface-elevated);
  box-shadow: var(--ny-shadow-float);
  animation: ny-settings-dialog-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ny-settings-confirm.is-closing .ny-settings-confirm__panel {
  animation: ny-settings-dialog-out 130ms cubic-bezier(0.4, 0, 1, 1) forwards;
}

.ny-settings-confirm__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ny-text-primary);
}

.ny-settings-confirm__body {
  margin: 0;
  color: var(--ny-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}

.ny-settings-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

@keyframes ny-settings-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes ny-settings-overlay-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes ny-settings-dialog-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes ny-settings-dialog-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.988);
  }
}
`;

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;

  constructor() {
    ensureStyle('ny-settings-panel', styles);
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  open() {
    if (this.overlay) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ny-settings-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;

    let working: Settings = structuredClone(getSettings());
    let previewTimer: number | null = null;

    const dialog = document.createElement('div');
    dialog.className = 'ny-settings-dialog';
    dialog.innerHTML = `
      <header>
        <h3 data-i18n="settings.title">Settings</h3>
        <p class="ny-settings-dialog__subtitle" data-i18n="settings.subtitle">Personalise the editor without leaving the document.</p>
      </header>
    `;

    const body = document.createElement('div');
    body.className = 'ny-settings-dialog__body';

    const scheduleAppearancePreview = (appearance: Settings['appearance']) => {
      if (previewTimer !== null) {
        window.clearTimeout(previewTimer);
      }
      previewTimer = window.setTimeout(() => {
        previewTimer = null;
        previewAppearance(appearance);
      }, 180);
    };

    const general = renderGeneralSection(working.general, (next) => {
      working = { ...working, general: next };
    });
    const appearance = renderAppearanceSection(
      working.appearance,
      (next, mode) => {
        working = { ...working, appearance: next };
        if (mode === 'commit') {
          if (previewTimer !== null) {
            window.clearTimeout(previewTimer);
            previewTimer = null;
          }
          previewAppearance(next);
          return;
        }
        scheduleAppearancePreview(next);
      }
    );
    const save = renderSaveSection(working.save, (next) => {
      working = { ...working, save: next };
    });
    const attachments = renderAttachmentsSection(
      working.attachments,
      (next) => {
        working = { ...working, attachments: next };
      }
    );

    body.append(general, appearance, save, attachments);
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'ny-settings-dialog__actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className =
      'ny-settings-dialog__button ny-settings-dialog__button--danger';
    reset.textContent = 'Reset to defaults';
    reset.setAttribute('data-i18n', 'settings.reset');

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '10px';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ny-settings-dialog__button';
    cancel.textContent = 'Cancel';
    cancel.setAttribute('data-i18n', 'settings.cancel');

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className =
      'ny-settings-dialog__button ny-settings-dialog__button--primary';
    ok.textContent = 'OK';
    ok.setAttribute('data-i18n', 'settings.ok');

    buttons.append(cancel, ok);
    actions.append(reset, buttons);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    translateDOM(overlay);

    let closing = false;

    const close = async () => {
      if (closing) return;
      closing = true;
      if (previewTimer !== null) {
        window.clearTimeout(previewTimer);
        previewTimer = null;
      }
      previewAppearance(getSettings().appearance);
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('is-closing');
      await this.wait(150);
      overlay.remove();
      this.overlay = null;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void close();
    };
    document.addEventListener('keydown', onKey);

    cancel.addEventListener('click', () => void close());
    ok.addEventListener('click', async () => {
      // `working` is always a sanitized, valid snapshot (each section clamps on
      // commit and reverts invalid input), so OK never needs to be blocked by a
      // transient :invalid field. Persist in the background and always close;
      // never let a slow or failed save trap the dialog open.
      void saveSettings(working).catch((error) => {
        void errorDialog(String(error));
      });
      await close();
    });
    reset.addEventListener('click', async () => {
      const confirmed = await this.confirmReset(dialog);
      if (!confirmed) return;
      await resetSettings();
      await close();
    });
  }

  private async confirmReset(host: HTMLElement): Promise<boolean> {
    return await new Promise((resolve) => {
      const confirm = document.createElement('div');
      confirm.className = 'ny-settings-confirm';
      confirm.innerHTML = `
        <div class="ny-settings-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="ny-settings-confirm-title">
          <h4 class="ny-settings-confirm__title" id="ny-settings-confirm-title" data-i18n="settings.confirmResetTitle">Reset all settings?</h4>
          <p class="ny-settings-confirm__body" data-i18n="settings.confirmResetBody">This will restore appearance, auto-save, and attachment options to their defaults. This action cannot be undone.</p>
          <div class="ny-settings-confirm__actions">
            <button type="button" class="ny-settings-dialog__button" data-action="cancel" data-i18n="settings.cancel">Cancel</button>
            <button type="button" class="ny-settings-dialog__button ny-settings-dialog__button--danger" data-action="confirm" data-i18n="settings.confirmResetButton">Reset</button>
          </div>
        </div>
      `;

      let closing = false;

      const close = async (accepted: boolean) => {
        if (closing) return;
        closing = true;
        document.removeEventListener('keydown', onKey, true);
        confirm.classList.add('is-closing');
        await this.wait(130);
        confirm.remove();
        resolve(accepted);
      };

      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          void close(false);
        }
      };

      document.addEventListener('keydown', onKey, true);
      confirm
        .querySelector<HTMLElement>('[data-action="cancel"]')
        ?.addEventListener('click', () => void close(false));
      confirm
        .querySelector<HTMLElement>('[data-action="confirm"]')
        ?.addEventListener('click', () => void close(true));

      host.appendChild(confirm);
      translateDOM(confirm);
    });
  }
}
