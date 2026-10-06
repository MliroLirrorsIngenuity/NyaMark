import { errorDialog, openDirectoryDialog } from '../../bridge/ipc/files';
import { translateDOM } from '../../i18n/dom';
import { isMacOS } from '../../platform/detect';
import {
  type Settings,
  changedSettings,
  getSettings,
  previewAppearance,
  resetSettings,
  updateSettings,
} from '../../state/settings';
import { ensureStyle } from '../../style/register';
import { forInputMethod } from '../ime';
import { animationsSettled, isModalOpen, openModal } from '../modal';
import { requireElement } from '../require-element';
import type { AiSection } from './sections/ai';
import { renderAppearanceSection } from './sections/appearance';
import { renderAttachmentsSection } from './sections/attachments';
import { renderGeneralSection } from './sections/general';
import { renderSaveSection } from './sections/save-policy';

const styles = `
.ny-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--ny-layer-settings-dialog);
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
  padding: 24px 24px 20px;
  border: 1px solid var(--ny-dock-border);
  border-radius: 20px;
  background: var(--ny-dock-bg);
  box-shadow: 0 32px 72px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.06);
  color: var(--ny-text-primary);
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
  transform-origin: center center;
  animation: ny-settings-dialog-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

:root[data-theme="dark"] .ny-settings-dialog {
  box-shadow: 0 32px 72px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
}

.ny-settings-overlay.is-closing .ny-settings-dialog {
  animation: ny-settings-dialog-out 150ms cubic-bezier(0.4, 0, 1, 1) forwards;
}

.ny-settings-dialog h3 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 650;
}

.ny-settings-dialog__subtitle {
  margin: 0 0 14px;
  color: var(--ny-text-secondary);
  font-size: 12.5px;
}

/* A segmented control, as the assistant's own switches. */
.ny-settings-tabs {
  display: inline-flex;
  gap: 2px;
  margin: 0 0 14px;
  padding: 3px;
  border-radius: 10px;
  background: var(--ny-fill-soft);
}

.ny-settings-tabs__tab {
  min-width: 72px;
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ny-text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: default;
}

.ny-settings-tabs__tab:hover {
  color: var(--ny-text-primary);
}

.ny-settings-tabs__tab[aria-selected="true"] {
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--ny-line), 0 1px 3px rgba(15, 23, 42, 0.08);
}

/* On the dark card the selected tab is lit, where the light one is white. */
:root[data-theme="dark"] .ny-settings-tabs__tab[aria-selected="true"] {
  background: color-mix(in srgb, var(--ny-text-primary) 12%, var(--ny-dock-bg));
}

.ny-settings-tabs__tab:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 1px;
}

.ny-settings-dialog__pane[hidden] {
  display: none;
}

/* The padding keeps focus rings clear of the scroll edge; the margin takes it
   back, to start the fields where the title and the buttons start. */
.ny-settings-dialog__body {
  overflow: auto;
  margin: 0 -8px;
  padding: 0 8px;
}

/* Each section is a group on a quiet fill; its controls stand on it in the
   card's own colour. */
.ny-settings__section {
  padding: 14px 16px 8px;
  border-radius: 14px;
  background: var(--ny-fill-soft);
}

.ny-settings__section + .ny-settings__section {
  margin-top: 10px;
}

.ny-settings__section-title {
  margin: 0 0 10px;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ny-text-primary);
}

.ny-settings__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-bottom: 10px;
}

.ny-settings__row[hidden] {
  display: none;
}

.ny-settings__field {
  position: relative;
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
  gap: 10px;
  flex: 0 1 auto;
  color: var(--ny-text-primary);
  font-size: 13px;
  cursor: pointer;
}

.ny-settings__field--checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 34px;
  height: 20px;
  background: color-mix(in srgb, var(--ny-text-primary) 18%, transparent);
  border-radius: 20px;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  margin: 0;
}

.ny-settings__field--checkbox input[type="checkbox"]:checked {
  background: var(--ny-accent);
}

.ny-settings__field--checkbox input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ny-settings__field--checkbox input[type="checkbox"]:checked::after {
  transform: translateX(14px);
}

.ny-settings__field--checkbox:hover input[type="checkbox"]:not(:checked) {
  background: color-mix(in srgb, var(--ny-text-primary) 24%, transparent);
}

.ny-settings__field--checkbox input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 2px;
}

/* The controls on a section: one height, one border, one focus ring. */
.ny-settings__field input[type="number"],
.ny-settings__select-trigger,
.ny-settings__directory-path {
  box-sizing: border-box;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ny-line);
  border-radius: 10px;
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
}

.ny-settings__field input[type="number"]:focus-visible,
.ny-settings__select-trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--ny-accent) 60%, transparent);
  box-shadow: 0 0 0 3px var(--ny-accent-soft);
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
  gap: 8px;
  cursor: pointer;
  text-align: left;
}

.ny-settings__select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-settings__select-trigger:hover,
.ny-settings__field input[type="number"]:hover:not(:focus) {
  border-color: color-mix(in srgb, var(--ny-text-primary) 20%, transparent);
}

.ny-settings__directory,
.ny-settings__version {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ny-settings__directory-path {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ny-settings__version-number {
  flex: 1 1 auto;
  color: var(--ny-text-primary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.ny-settings__directory-path.is-empty {
  color: var(--ny-text-secondary);
}

.ny-settings__directory-button,
.ny-settings__version-button {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--ny-line);
  border-radius: 10px;
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.ny-settings__directory-button:hover,
.ny-settings__version-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ny-text-primary) 20%, transparent);
}

.ny-settings__version-button:disabled {
  color: var(--ny-text-secondary);
  cursor: default;
}

.ny-settings__directory-button[hidden] {
  display: none;
}

.ny-settings__select-icon {
  flex: 0 0 auto;
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
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 150;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  /* The surface tokens turn translucent with window transparency; a menu
     over other controls needs the opaque page colour. */
  background: var(--ny-app-bg-end);
  border: 1px solid var(--ny-line);
  border-radius: 12px;
  box-shadow: var(--ny-menu-shadow);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ny-settings__select-menu[hidden] {
  display: none;
}

.ny-settings__select.is-up .ny-settings__select-menu {
  top: auto;
  bottom: calc(100% + 6px);
}

/* A button that opens a menu of actions: as wide as its label, its menu as
   wide as the longest action. */
.ny-settings__select--menu {
  width: fit-content;
}

.ny-settings__select--menu .ny-settings__select-trigger {
  width: auto;
  justify-content: flex-start;
  padding: 0 10px 0 8px;
  font-weight: 500;
}

.ny-settings__select--menu .ny-settings__select-menu {
  right: auto;
  min-width: 220px;
}

.ny-settings__select-lead {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ny-text-secondary);
}

.ny-settings__select-separator {
  flex: none;
  height: 1px;
  margin: 4px 6px;
  background: var(--ny-line);
}

.ny-settings__select-option {
  flex: none;
  width: 100%;
  min-height: 32px;
  text-align: left;
  padding: 0 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

/* The option the arrow keys are on is lit, where the dialog's controls
   take a ring (shell.css); the selector outweighs that one. */
.ny-settings__select-option:hover,
.ny-settings__select .ny-settings__select-menu
  .ny-settings__select-option:focus-visible:not(.is-selected) {
  outline: none;
  background: var(--ny-fill-soft);
}

.ny-settings__select .ny-settings__select-menu
  .ny-settings__select-option.is-selected:focus-visible {
  outline: none;
}

.ny-settings__select-option.is-selected {
  background: var(--ny-accent-soft);
  color: var(--ny-accent-ink);
  font-weight: 600;
}

.ny-settings__field input[type="number"]:invalid,
.ny-settings__field[data-invalid="true"] input[type="number"] {
  border-color: color-mix(in srgb, var(--ny-del-ink) 60%, transparent);
  box-shadow: 0 0 0 3px var(--ny-del-soft);
}

/* The range shows under its field in the space before the next row, so the
   rows keep their spacing while it is empty. */
.ny-settings__field-hint {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--ny-del-ink);
}

/* The section is the frame already; the legend reads as a field's label. */
.ny-settings__fieldset {
  width: 100%;
  border: none;
  padding: 0;
  margin: 0;
}
.ny-settings__fieldset legend {
  padding: 0;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--ny-text-secondary);
}

.ny-settings__options {
  display: grid;
  gap: 6px;
}

.ny-settings__option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--ny-line);
  border-radius: 12px;
  background: var(--ny-dock-bg);
}

/* As the same choice looks in the dialog a pasted image asks it in. */
.ny-settings__option:has(input:checked) {
  border-color: var(--ny-accent-line);
  box-shadow: 0 0 0 3px var(--ny-accent-soft);
}

.ny-settings__option input[type="radio"] {
  margin-top: 3px;
  accent-color: var(--ny-accent);
}

.ny-settings__option strong {
  display: block;
  margin-bottom: 2px;
  font-size: 13px;
  font-weight: 600;
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
  margin-top: 16px;
}

.ny-settings-dialog__button {
  min-width: 80px;
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--ny-line);
  border-radius: 10px;
  background: var(--ny-dock-bg);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: default;
}

.ny-settings-dialog__button:hover {
  background: var(--ny-fill-soft);
}

/* The one action the dialog asks for, in ink, as in the assistant's cards. */
.ny-settings-dialog__button--primary {
  border-color: transparent;
  background: var(--ny-ink);
  color: var(--ny-on-ink);
  font-weight: 600;
}

.ny-settings-dialog__button--primary:hover {
  background: color-mix(in srgb, var(--ny-ink) 86%, var(--ny-dock-bg));
}

.ny-settings-dialog__button--danger {
  border-color: transparent;
  background: var(--ny-del-soft);
  color: var(--ny-del-ink);
}

.ny-settings-dialog__button--danger:hover {
  background: color-mix(in srgb, var(--ny-del-ink) 16%, var(--ny-del-soft));
}

.ny-settings-dialog__button:focus-visible {
  outline: 2px solid var(--ny-accent-line);
  outline-offset: 2px;
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
  border-radius: 20px;
  background: color-mix(in srgb, var(--ny-app-bg-end), transparent 36%);
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
  border: 1px solid var(--ny-line);
  border-radius: 16px;
  background: var(--ny-dock-bg);
  box-shadow: var(--ny-menu-shadow);
  animation: ny-settings-dialog-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ny-settings-confirm.is-closing .ny-settings-confirm__panel {
  animation: ny-settings-dialog-out 130ms cubic-bezier(0.4, 0, 1, 1) forwards;
}

.ny-settings-confirm__title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 650;
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
  gap: 8px;
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

type SettingsPanelActions = {
  /** Resolves once the answer has been shown. */
  checkForUpdates: () => Promise<void>;
};

export type SettingsTab = 'general' | 'ai';

const TABS: readonly SettingsTab[] = ['general', 'ai'];

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;

  constructor(private readonly actions: SettingsPanelActions) {
    ensureStyle('ny-settings-panel', styles);
  }

  /** `addService` opens the AI tab's service set up from that preset. */
  open(tab: SettingsTab = 'general', options: { addService?: string } = {}) {
    // Over another dialog, from the menu or the title bar's gear, it opened
    // beneath that one and took its focus.
    if (this.overlay || isModalOpen()) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ny-settings-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const opened = structuredClone(getSettings());
    let working: Settings = structuredClone(opened);
    let previewTimer: number | null = null;
    let closing = false;

    const dialog = document.createElement('div');
    dialog.className = 'ny-settings-dialog';
    dialog.innerHTML = `
      <header>
        <h3 data-i18n="settings.title">Settings</h3>
        <p class="ny-settings-dialog__subtitle" data-i18n="settings.subtitle">Adjust how the editor looks and behaves.</p>
        <div class="ny-settings-tabs" role="tablist">
          <button type="button" role="tab" class="ny-settings-tabs__tab" id="ny-settings-tab-general" aria-controls="ny-settings-pane-general" data-tab="general" data-i18n="settings.tabs.general">General</button>
          <button type="button" role="tab" class="ny-settings-tabs__tab" id="ny-settings-tab-ai" aria-controls="ny-settings-pane-ai" data-tab="ai" data-i18n="settings.tabs.ai">AI assistant</button>
        </div>
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

    const general = renderGeneralSection(
      working.general,
      (next) => {
        working = { ...working, general: next };
      },
      // macOS checks from the app menu; elsewhere there is no menu bar.
      isMacOS() ? undefined : { checkForUpdates: this.actions.checkForUpdates }
    );
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
      },
      { pickDirectory: () => openDirectoryDialog() }
    );

    const panes = new Map<SettingsTab, HTMLElement>();
    for (const name of TABS) {
      const pane = document.createElement('div');
      pane.className = 'ny-settings-dialog__pane';
      pane.id = `ny-settings-pane-${name}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', `ny-settings-tab-${name}`);
      panes.set(name, pane);
      body.append(pane);
    }
    panes.get('general')?.append(general, appearance, save, attachments);
    dialog.appendChild(body);

    // The AI tab loads with its first showing: the services it talks to
    // stay out of the start-up code.
    let aiLoaded: Promise<void> | null = null;
    let aiSection: AiSection | null = null;
    /** Keys typed in the AI tab, held until OK keeps them or the dialog goes. */
    let secretsSettled = false;
    const settleSecrets = async (keep: boolean) => {
      if (!aiLoaded || secretsSettled) return;
      secretsSettled = true;
      await aiLoaded.catch(() => undefined);
      await aiSection?.settled();
      // Loaded with the tab already; imported here to stay out of start-up.
      const { commitAiSecrets, discardAiSecrets } = await import(
        '../../bridge/ipc/ai'
      );
      if (!keep) {
        await discardAiSecrets();
        return;
      }
      await commitAiSecrets();
      aiSection?.committed();
    };
    const loadAi = () => {
      aiLoaded ??= import('./sections/ai').then(({ renderAiSection }) => {
        if (closing) return;
        aiSection = renderAiSection(
          working.ai,
          (next) => {
            working = { ...working, ai: next };
          },
          { proxy: () => working.ai.proxy }
        );
        panes.get('ai')?.append(aiSection.element);
      });
      aiLoaded.catch((error) => {
        console.error('Failed to load the AI settings:', error);
      });
      return aiLoaded;
    };

    const tabs = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('.ny-settings-tabs__tab')
    );
    const showTab = (name: SettingsTab, focus = false) => {
      for (const button of tabs) {
        const selected = button.dataset.tab === name;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      }
      for (const [key, pane] of panes) pane.hidden = key !== name;
      body.scrollTop = 0;
      if (name === 'ai') loadAi();
    };
    for (const button of tabs) {
      button.addEventListener('click', () => {
        showTab(button.dataset.tab as SettingsTab);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = TABS.indexOf(button.dataset.tab as SettingsTab);
        const step = event.key === 'ArrowRight' ? 1 : -1;
        showTab(TABS[(index + step + TABS.length) % TABS.length], true);
      });
    }
    showTab(tab);
    const service = options.addService;
    if (service && tab === 'ai') {
      // Logged by `loadAi` when it fails.
      loadAi().then(
        () => aiSection?.addService(service),
        () => undefined
      );
    }

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

    const close = async () => {
      if (closing) return;
      closing = true;
      void settleSecrets(false).catch(console.error);
      aiSection?.destroy();
      // Handing the focus back blurs a field still being typed in, and its
      // change event previews that value: a font size typed and then
      // cancelled with Escape stayed on the page.
      modal.release();
      if (previewTimer !== null) {
        window.clearTimeout(previewTimer);
        previewTimer = null;
      }
      previewAppearance(getSettings().appearance);
      overlay.classList.add('is-closing');
      await animationsSettled(overlay);
      overlay.remove();
      this.overlay = null;
    };

    // A stray click on the backdrop must not throw away edited settings.
    const modal = openModal({
      overlay,
      dialog,
      dismissOnBackdrop: false,
      initialFocus: ok,
      onDismiss: () => void close(),
    });

    // Return in a number field presses OK, as Return does in a native
    // dialog; it did nothing. Leaving the field first lets its change event
    // take the value in, or put back one out of range.
    dialog.addEventListener('keydown', (event) => {
      const field = event.target;
      if (event.key !== 'Enter' || forInputMethod(event)) return;
      if (!(field instanceof HTMLInputElement) || field.type !== 'number') {
        return;
      }
      event.preventDefault();
      field.blur();
      ok.click();
    });
    cancel.addEventListener('click', () => void close());
    ok.addEventListener('click', async () => {
      // `working` is always a sanitized, valid snapshot (each section clamps on
      // commit and reverts invalid input), so OK never needs to be blocked by a
      // transient :invalid field. Persist in the background and always close;
      // never let a slow or failed save trap the dialog open. Only what was
      // changed here is written, over what other windows changed meanwhile.
      void updateSettings(changedSettings(opened, working)).catch((error) => {
        void errorDialog(String(error));
      });
      void settleSecrets(true).catch((error) => {
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
        modal.release();
        confirm.classList.add('is-closing');
        await animationsSettled(confirm);
        confirm.remove();
        resolve(accepted);
      };

      const cancelButton = confirm.querySelector<HTMLElement>(
        '[data-action="cancel"]'
      );
      cancelButton?.addEventListener('click', () => void close(false));
      confirm
        .querySelector<HTMLElement>('[data-action="confirm"]')
        ?.addEventListener('click', () => void close(true));

      host.appendChild(confirm);
      translateDOM(confirm);
      const modal = openModal({
        overlay: confirm,
        dialog: requireElement(confirm, '.ny-settings-confirm__panel'),
        role: 'alertdialog',
        labelledBy: 'ny-settings-confirm-title',
        initialFocus: cancelButton,
        onDismiss: () => void close(false),
      });
    });
  }
}
