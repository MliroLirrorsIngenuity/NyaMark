import { openExternalUrl } from '../bridge/ipc/attachments';
import type { DownloadEvent, Update } from '../bridge/ipc/updates';
import { anyWindowDirty, requestAppRestart } from '../bridge/ipc/windows';
import { i18next } from '../i18n';
import { getPlatform } from '../platform/detect';
import { ensureStyle } from '../style/register';
import { animationsSettled, openModal } from './modal';
import { renderReleaseNotes } from './release-notes';
import { requireElement } from './require-element';

const updateDialogStyles = `
.ny-update-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--ny-layer-update-dialog);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  background: color-mix(in srgb, var(--ny-app-bg-end), transparent 24%);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  overflow-y: auto;
  animation: ny-update-overlay-in 160ms ease-out;
}

.ny-update-overlay::before,
.ny-update-overlay::after {
  content: "";
  flex: 1;
  min-height: 48px;
}

.ny-update-overlay.is-closing {
  pointer-events: none;
  animation: ny-update-overlay-out 140ms ease-in forwards;
}

.ny-update-dialog {
  width: min(760px, calc(100vw - 48px));
  max-height: min(760px, calc(100vh - 104px));
  flex-shrink: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  border: 1px solid var(--ny-border-strong);
  border-radius: 28px;
  background: var(--ny-surface-elevated);
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.22);
  color: var(--ny-text-primary);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  animation: ny-update-dialog-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ny-update-overlay.is-closing .ny-update-dialog {
  animation: ny-update-dialog-out 150ms cubic-bezier(0.4, 0, 1, 1) forwards;
}

.ny-update-dialog__header {
  padding: 28px 30px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 42%);
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--ny-accent), transparent 78%) 0%, transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--ny-surface-elevated), var(--ny-accent-soft) 16%) 0%, var(--ny-surface-elevated) 100%);
}

.ny-update-dialog__eyebrow {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin-bottom: 12px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--ny-accent), transparent 62%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-accent-soft), transparent 18%);
  color: var(--ny-accent);
  font-size: 12px;
  font-weight: 700;
}

.ny-update-dialog h3 {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 760;
}

.ny-update-dialog__subtitle {
  margin: 10px 0 0;
  color: var(--ny-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.ny-update-dialog__body {
  min-height: 0;
  overflow: auto;
  padding: 20px 30px 6px;
}

.ny-update-dialog__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.ny-update-dialog__meta-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 28%);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ny-surface-muted), transparent 20%);
}

.ny-update-dialog__meta-label {
  margin: 0 0 5px;
  color: var(--ny-text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.ny-update-dialog__meta-value {
  margin: 0;
  overflow: hidden;
  color: var(--ny-text-primary);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ny-update-dialog__section {
  padding: 16px 0;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 42%);
}

.ny-update-dialog__section:first-child {
  border-top: none;
}

.ny-update-dialog__section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 760;
  letter-spacing: 0;
  text-transform: uppercase;
}

.ny-update-dialog__notes {
  max-height: 220px;
  margin: 0;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 34%);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ny-surface-ghost), transparent 24%);
  color: var(--ny-text-secondary);
  font: 12.5px/1.55 var(--ny-font-sans);
  overflow: auto;
  user-select: text;
  -webkit-user-select: text;
}

.ny-update-dialog__notes h5 {
  margin: 12px 0 4px;
  color: var(--ny-text-primary);
  font-size: 12.5px;
  font-weight: 650;
}

.ny-update-dialog__notes p {
  margin: 6px 0;
}

.ny-update-dialog__notes ul {
  margin: 0;
  padding-left: 18px;
}

.ny-update-dialog__notes li {
  margin: 3px 0;
}

.ny-update-dialog__notes > :first-child {
  margin-top: 0;
}

.ny-update-dialog__notes > :last-child {
  margin-bottom: 0;
}

.ny-release-notes__scope {
  color: var(--ny-text-muted);
  font-weight: 600;
}

.ny-update-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 30px 24px;
  border-top: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 42%);
}

.ny-update-dialog__button {
  min-width: 92px;
  padding: 9px 14px;
  border: 1px solid color-mix(in srgb, var(--ny-border-strong), transparent 8%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ny-surface-elevated), transparent 12%);
  color: var(--ny-text-primary);
  font: inherit;
  font-size: 13px;
  cursor: default;
}

.ny-update-dialog__button--primary {
  font-variant-numeric: tabular-nums;
  border-color: color-mix(in srgb, var(--ny-accent), transparent 44%);
  background: color-mix(in srgb, var(--ny-accent), var(--ny-surface-elevated) 14%);
  color: var(--ny-on-accent);
}

.ny-update-dialog__button:hover {
  border-color: color-mix(in srgb, var(--ny-accent), transparent 36%);
}

.ny-update-dialog__button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ny-accent), transparent 40%);
  outline-offset: 2px;
}

.ny-update-dialog__button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

@media (max-width: 700px) {
  .ny-update-dialog__meta {
    grid-template-columns: 1fr;
  }

  .ny-update-dialog__actions {
    flex-direction: column-reverse;
  }

  .ny-update-dialog__button {
    width: 100%;
  }
}

@keyframes ny-update-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ny-update-overlay-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes ny-update-dialog-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes ny-update-dialog-out {
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

function formatDate(value: string | null) {
  if (!value) return i18next.t('updates.unknownDate');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return i18next.t('updates.unknownDate');

  return new Intl.DateTimeFormat(i18next.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function appendMetaCard(host: HTMLElement, label: string, value: string) {
  const card = document.createElement('div');
  card.className = 'ny-update-dialog__meta-card';

  const labelEl = document.createElement('p');
  labelEl.className = 'ny-update-dialog__meta-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('p');
  valueEl.className = 'ny-update-dialog__meta-value';
  valueEl.textContent = value;
  valueEl.title = value;

  card.append(labelEl, valueEl);
  host.appendChild(card);
}

/** How long a download may go without a byte before it is given up. */
const DOWNLOAD_STALL_MS = 30_000;

/**
 * `update.download`, given up once `DOWNLOAD_STALL_MS` pass with no byte
 * arriving: a dropped connection left the dialog on "Downloading" for good,
 * with every way out of it switched off.
 */
function downloadUpdate(
  update: Update,
  onEvent: (event: DownloadEvent) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => reject(new Error('The update download stalled')),
        DOWNLOAD_STALL_MS
      );
    };
    wait();
    update
      .download((event) => {
        wait();
        onEvent(event);
      })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

export class UpdateDialog {
  private overlay: HTMLDivElement | null = null;

  constructor() {
    ensureStyle('ny-update-dialog', updateDialogStyles);
  }

  open(update: Update) {
    if (this.overlay) return;

    const currentVersion = update.currentVersion;

    const overlay = document.createElement('div');
    overlay.className = 'ny-update-overlay';
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const dialog = document.createElement('div');
    dialog.className = 'ny-update-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'ny-update-title');

    const header = document.createElement('header');
    header.className = 'ny-update-dialog__header';
    header.innerHTML = `
      <div class="ny-update-dialog__eyebrow"></div>
      <h3 id="ny-update-title"></h3>
      <p class="ny-update-dialog__subtitle" aria-live="polite"></p>
    `;
    requireElement(header, '.ny-update-dialog__eyebrow').textContent =
      i18next.t('updates.newVersionAvailable');
    requireElement(header, 'h3').textContent = i18next.t('updates.title');
    // The line under the title says how the update went; with no word of it a
    // failed download only changed the buttons.
    const subtitle = requireElement(header, '.ny-update-dialog__subtitle');
    const say = (key: string) => {
      subtitle.textContent = i18next.t(key, {
        current: currentVersion,
        latest: update.version,
      });
    };
    say('updates.subtitle');

    const body = document.createElement('div');
    body.className = 'ny-update-dialog__body';

    const meta = document.createElement('div');
    meta.className = 'ny-update-dialog__meta';
    appendMetaCard(meta, i18next.t('updates.currentVersion'), currentVersion);
    appendMetaCard(meta, i18next.t('updates.latestVersion'), update.version);
    appendMetaCard(
      meta,
      i18next.t('updates.publishedAt'),
      formatDate(update.date ?? null)
    );
    body.appendChild(meta);

    const notesSection = document.createElement('section');
    notesSection.className = 'ny-update-dialog__section';
    const notesTitle = document.createElement('h4');
    notesTitle.className = 'ny-update-dialog__section-title';
    notesTitle.textContent = i18next.t('updates.releaseNotes');
    const notes = document.createElement('div');
    notes.className = 'ny-update-dialog__notes';
    if (!renderReleaseNotes(notes, update.body ?? '')) {
      notes.textContent = i18next.t('updates.noReleaseNotes');
    }
    notesSection.append(notesTitle, notes);
    body.appendChild(notesSection);

    const actions = document.createElement('div');
    actions.className = 'ny-update-dialog__actions';

    const later = this.createButton(i18next.t('updates.later'));
    const updateNow = this.createButton(i18next.t('updates.updateNow'), true);

    actions.append(later, updateNow);
    dialog.append(header, body, actions);
    overlay.appendChild(dialog);

    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      modal.release();
      overlay.classList.add('is-closing');
      await animationsSettled(overlay);
      overlay.remove();
      this.overlay = null;
    };

    // One click handler driven by a phase, so a failed or finished install
    // never leaves the original "download" handler attached underneath.
    let phase: 'idle' | 'downloading' | 'downloaded' | 'installed' | 'failed' =
      'idle';

    // Dismissing mid-download would let the install finish unseen and the
    // app relaunch out of nowhere.
    const modal = openModal({
      overlay,
      dialog,
      labelledBy: 'ny-update-title',
      initialFocus: updateNow,
      canDismiss: () => phase !== 'downloading',
      onDismiss: () => void close(),
    });
    // A button lets go of focus as it is disabled, and focus went to the page
    // behind, where Enter did nothing once the buttons came back. The dialog
    // holds it while they are off, and the button takes it back after.
    const holdFocus = () => dialog.focus();
    const returnFocus = () => {
      const active = document.activeElement;
      if (active === dialog || active === document.body) updateNow.focus();
    };
    const busy = (label: string) => {
      phase = 'downloading';
      updateNow.disabled = true;
      later.disabled = true;
      holdFocus();
      updateNow.textContent = label;
    };
    const fail = (error: unknown) => {
      console.error(error);
      phase = 'failed';
      say('updates.failed');
      later.textContent = i18next.t('updates.closeDialog');
      later.disabled = false;
      updateNow.textContent = i18next.t('updates.openDownloadPage');
      updateNow.disabled = false;
      returnFocus();
    };
    const install = async () => {
      // The Windows installer ends NyaMark the moment it starts, past every
      // unsaved-changes prompt, so the documents are saved before it runs.
      if (getPlatform() === 'windows' && (await anyWindowDirty())) {
        phase = 'downloaded';
        say('updates.saveFirst');
        updateNow.textContent = i18next.t('updates.installNow');
        updateNow.disabled = false;
        later.disabled = false;
        returnFocus();
        return;
      }
      updateNow.textContent = i18next.t('updates.installing');
      await update.install();
      phase = 'installed';
      say('updates.installed');
      // Only returns when a window with unsaved changes declined to close;
      // the update is installed either way, so offer to restart again or later.
      await requestAppRestart();
      updateNow.textContent = i18next.t('updates.restartNow');
      updateNow.disabled = false;
      later.textContent = i18next.t('updates.restartLater');
      later.disabled = false;
      returnFocus();
    };
    later.addEventListener('click', () => void close());
    updateNow.addEventListener('click', () => {
      if (phase === 'downloading') return;

      if (phase === 'installed') {
        updateNow.disabled = true;
        holdFocus();
        void requestAppRestart()
          .catch(console.error)
          .finally(() => {
            updateNow.disabled = false;
            returnFocus();
          });
        return;
      }

      if (phase === 'failed') {
        void openExternalUrl(
          'https://github.com/MliroLirrorsIngenuity/NyaMark/releases'
        ).catch(console.error);
        void close();
        return;
      }

      if (phase === 'downloaded') {
        busy(i18next.t('updates.installing'));
        install().catch(fail);
        return;
      }

      busy(i18next.t('updates.downloading'));
      let downloaded = 0;
      let contentLength: number | null = null;

      downloadUpdate(update, (event: DownloadEvent) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? null;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength && contentLength > 0) {
              const pct = Math.round((downloaded / contentLength) * 100);
              updateNow.textContent = `${i18next.t('updates.downloading')} ${pct}%`;
            }
            break;
        }
      })
        .then(install)
        .catch(fail);
    });
  }

  private createButton(label: string, primary = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary
      ? 'ny-update-dialog__button ny-update-dialog__button--primary'
      : 'ny-update-dialog__button';
    button.textContent = label;
    return button;
  }
}
