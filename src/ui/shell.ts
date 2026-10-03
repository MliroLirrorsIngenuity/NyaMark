import { type ResizeDirection, startWindowResize } from '../bridge/ipc/windows';
import { getPlatform } from '../platform/detect';
import { ensureStyle } from '../style/register';
import shellStyles from './shell.css?inline';

export function registerShellStyles() {
  ensureStyle('app-shell', shellStyles);
}

const linuxResizeHandles: Array<{
  direction: ResizeDirection;
  className: string;
}> = [
  { direction: 'North', className: 'ny-shell__resize-handle--n' },
  { direction: 'South', className: 'ny-shell__resize-handle--s' },
  { direction: 'West', className: 'ny-shell__resize-handle--w' },
  { direction: 'East', className: 'ny-shell__resize-handle--e' },
  { direction: 'NorthWest', className: 'ny-shell__resize-handle--nw' },
  { direction: 'NorthEast', className: 'ny-shell__resize-handle--ne' },
  { direction: 'SouthWest', className: 'ny-shell__resize-handle--sw' },
  { direction: 'SouthEast', className: 'ny-shell__resize-handle--se' },
];

function renderLinuxResizeHandles() {
  return linuxResizeHandles
    .map(
      ({ direction, className }) =>
        `<div class="ny-shell__resize-handle ${className}" data-resize-direction="${direction}" aria-hidden="true"></div>`
    )
    .join('');
}

function bindLinuxResizeHandles(host: HTMLElement) {
  for (const handle of host.querySelectorAll<HTMLElement>(
    '[data-resize-direction]'
  )) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const direction = handle.dataset.resizeDirection as
        | ResizeDirection
        | undefined;
      if (!direction) return;

      void startWindowResize(direction).catch(console.error);
    });
  }
}

export function renderAppShell(host: HTMLElement) {
  const platformClass = getPlatform();
  const isMac = platformClass === 'macos';
  const isLinux = platformClass === 'linux';
  const initialThemeLabel = window.matchMedia?.('(prefers-color-scheme: dark)')
    .matches
    ? 'Dark'
    : 'Light';
  const newShortcutHint = isMac ? '⌘N' : 'Ctrl+N';
  const openShortcutHint = isMac ? '⌘O' : 'Ctrl+O';
  const saveShortcutHint = isMac ? '⌘S' : 'Ctrl+S';
  const saveAsShortcutHint = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';
  const exportPdfShortcutHint = isMac ? '⌘P' : 'Ctrl+P';
  const outlineShortcutHint = isMac ? '⌘⇧O' : 'Ctrl+Shift+O';
  const settingsShortcutHint = 'Ctrl+,';
  // Tauri's drag region moves the window on macOS. On Windows and Linux,
  // `Titlebar` moves it and takes the double-click.
  const titlebarDragRegion = isMac ? ' data-tauri-drag-region' : '';
  // The title bar's buttons are small round icons, their shortcuts in the
  // tooltip. Windows and Linux carry the file menu and settings there too,
  // having no menu bar to hold them.
  const fileActionsMarkup = isMac
    ? ''
    : `
        <div class="ny-shell__file-menu">
          <button
            id="tb-file-menu-button"
            class="ny-shell__shortcut-button ny-shell__icon-button"
            type="button"
            title="File"
            aria-label="File"
            data-i18n-title="shell.file"
            data-i18n-aria-label="shell.file"
            aria-haspopup="menu"
            aria-expanded="false"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M4.25 1.75h5l3.5 3.5v8a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" />
              <path d="M9.25 1.75v3.5h3.5" />
            </svg>
          </button>
          <div id="tb-file-menu" class="ny-shell__menu" role="menu" hidden>
            <button class="ny-shell__menu-item" type="button" data-file-action="new" role="menuitem">
              <span data-i18n="shell.new">New</span>
              <span class="ny-shell__shortcut-hint">${newShortcutHint}</span>
            </button>
            <button class="ny-shell__menu-item" type="button" data-file-action="open" role="menuitem">
              <span data-i18n="shell.open">Open</span>
              <span class="ny-shell__shortcut-hint">${openShortcutHint}</span>
            </button>
            <button class="ny-shell__menu-item" type="button" data-file-action="save" role="menuitem">
              <span data-i18n="shell.save">Save</span>
              <span class="ny-shell__shortcut-hint">${saveShortcutHint}</span>
            </button>
            <button class="ny-shell__menu-item" type="button" data-file-action="save-as" role="menuitem">
              <span data-i18n="shell.saveAs">Save As</span>
              <span class="ny-shell__shortcut-hint">${saveAsShortcutHint}</span>
            </button>
            <button class="ny-shell__menu-item" type="button" data-file-action="export-pdf" role="menuitem">
              <span data-i18n="shell.exportPdf">Export as PDF</span>
              <span class="ny-shell__shortcut-hint">${exportPdfShortcutHint}</span>
            </button>
          </div>
        </div>
      `;

  document.documentElement.dataset.platform = platformClass;
  host.className = `ny-editor-root ny-shell ny-shell--${platformClass}`;
  // The shell's ids carry `ny-`: a heading takes its text as its id, and one
  // named "App" or "Statusbar" was styled as the window or the status bar.
  host.innerHTML = `
    ${isLinux ? renderLinuxResizeHandles() : ''}

    <div id="ny-titlebar"${titlebarDragRegion}>
      <div class="ny-shell__title-leading">
        <div class="ny-shell__title-quick-actions">${fileActionsMarkup}</div>
      </div>
      <div class="ny-shell__title-center">
        <div id="tb-filename" class="ny-shell__filename"></div>
        <span id="tb-dirty" class="ny-shell__dirty">●</span>
      </div>
      <div class="ny-shell__title-actions">
        <div class="ny-shell__title-meta">
          <div class="ny-shell__title-quick-actions">
            <button id="tb-settings" class="ny-shell__shortcut-button ny-shell__settings-button ny-shell__icon-button" type="button" title="Settings" aria-label="Settings" data-i18n-title="shell.settings" data-i18n-aria-label="shell.settings" data-shortcut="${settingsShortcutHint}">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button id="tb-outline" class="ny-shell__shortcut-button ny-shell__icon-button" type="button" title="Toggle outline" aria-label="Toggle outline" data-i18n-title="shell.outline" data-i18n-aria-label="shell.outline" data-shortcut="${outlineShortcutHint}">
              <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <path d="M2.75 4h10.5M4.75 8h8.5M6.75 12h6.5" />
              </svg>
            </button>
          </div>
        </div>
        <div class="ny-shell__window-controls" aria-label="Window controls" data-i18n-aria-label="shell.windowControls">
          <button id="tb-minimize" class="ny-shell__window-button" type="button" title="Minimize" aria-label="Minimize" data-i18n-title="shell.minimize" data-i18n-aria-label="shell.minimize" data-window-control>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5.5h10" />
            </svg>
          </button>
          <button id="tb-maximize" class="ny-shell__window-button" type="button" title="Maximize" aria-label="Maximize" data-i18n-title="shell.maximize" data-i18n-aria-label="shell.maximize" data-window-control>
            <svg class="ny-shell__maximize-glyph" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
            </svg>
            <svg class="ny-shell__restore-glyph" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
              <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </svg>
          </button>
          <button id="tb-close" class="ny-shell__window-button ny-shell__window-button--close" type="button" title="Close" aria-label="Close" data-i18n-title="shell.close" data-i18n-aria-label="shell.close" data-window-control>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="ny-shell__body">
      <div id="ny-editor-container"></div>
    </div>

    <div id="ny-statusbar">
      <div class="ny-shell__status-group">
        <span id="sb-words" class="ny-shell__status"></span>
        <span id="sb-lines" class="ny-shell__status"></span>
      </div>
      <div class="ny-shell__status-group">
        <button id="sb-theme" type="button" class="ny-shell__action">${initialThemeLabel}</button>
        <button id="sb-mode" type="button" class="ny-shell__action" title="Toggle source mode" aria-label="Toggle source mode" data-i18n-title="statusbar.modeToggle" data-i18n-aria-label="statusbar.modeToggle"></button>
      </div>
    </div>
  `;

  if (isLinux) bindLinuxResizeHandles(host);
}
