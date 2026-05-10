import { getCurrentWindow } from '@tauri-apps/api/window';
import { getPlatform } from '../platform/detect';

export { registerShellStyles } from './shell.css';

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

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
  host
    .querySelectorAll<HTMLElement>('[data-resize-direction]')
    .forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const direction = handle.dataset.resizeDirection as
          | ResizeDirection
          | undefined;
        if (!direction) return;

        void getCurrentWindow()
          .startResizeDragging(direction)
          .catch(console.error);
      });
    });
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
  const outlineShortcutHint = isMac ? '⌘⇧O' : 'Ctrl+Shift+O';
  const fileActionsMarkup = isMac
    ? ''
    : `
        <div class="ny-shell__file-menu">
          <button
            id="tb-file-menu-button"
            class="ny-shell__shortcut-button"
            type="button"
            title="File"
            aria-label="File"
            data-i18n-title="shell.file"
            data-i18n-aria-label="shell.file"
            aria-haspopup="menu"
            aria-expanded="false"
          >
            <span class="ny-shell__shortcut-label" data-i18n="shell.file">File</span>
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
          </div>
        </div>
      `;

  document.documentElement.dataset.platform = platformClass;
  host.className = `ny-editor-root ny-shell ny-shell--${platformClass}`;
  host.innerHTML = `
    ${isLinux ? renderLinuxResizeHandles() : ''}

    <div id="titlebar" data-tauri-drag-region>
      <div class="ny-shell__title-leading">
        <div class="ny-shell__title-quick-actions">${fileActionsMarkup}</div>
      </div>
      <div class="ny-shell__title-center">
        <div id="tb-filename" class="ny-shell__filename">Untitled.md</div>
        <span id="tb-dirty" class="ny-shell__dirty">●</span>
      </div>
      <div class="ny-shell__title-actions">
        <div class="ny-shell__title-meta">
          <div class="ny-shell__title-quick-actions">
            <button id="tb-settings" class="ny-shell__shortcut-button ny-shell__settings-button" type="button" title="Settings" aria-label="Settings" data-i18n-title="shell.settings" data-i18n-aria-label="shell.settings">
              <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
                <path fill="currentColor" d="M9.405 1.05c-.413-.014-1.397-.014-1.81 0a.75.75 0 0 0-.707.62l-.18 1.07a5.25 5.25 0 0 0-1.225.71L4.5 3.18a.75.75 0 0 0-.92.33l-.91 1.55a.75.75 0 0 0 .15.94l.81.74a5.27 5.27 0 0 0 0 1.4l-.81.74a.75.75 0 0 0-.15.94l.91 1.55a.75.75 0 0 0 .92.33l.99-.27c.37.3.78.54 1.22.71l.18 1.07a.75.75 0 0 0 .71.62c.41.014 1.4.014 1.81 0a.75.75 0 0 0 .71-.62l.18-1.07a5.27 5.27 0 0 0 1.22-.71l.99.27a.75.75 0 0 0 .92-.33l.91-1.55a.75.75 0 0 0-.15-.94l-.81-.74a5.3 5.3 0 0 0 0-1.4l.81-.74a.75.75 0 0 0 .15-.94l-.91-1.55a.75.75 0 0 0-.92-.33l-.99.27a5.25 5.25 0 0 0-1.22-.71L10.115 1.67a.75.75 0 0 0-.71-.62ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>
              </svg>
            </button>
            <button id="tb-outline" class="ny-shell__shortcut-button" type="button" title="Toggle outline" aria-label="Toggle outline" data-i18n-title="shell.outline" data-i18n-aria-label="shell.outline">
              <span class="ny-shell__shortcut-label" data-i18n="shell.outline">Outline</span>
              <span class="ny-shell__shortcut-hint">${outlineShortcutHint}</span>
            </button>
          </div>
        </div>
        <div class="ny-shell__window-controls" aria-label="Window controls" data-i18n-aria-label="shell.windowControls">
          <button id="tb-minimize" class="ny-shell__window-button" type="button" title="Minimize" aria-label="Minimize" data-i18n-title="shell.minimize" data-i18n-aria-label="shell.minimize" data-window-control>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path fill="currentColor" d="M2 5.25h8v1.5H2z" />
            </svg>
          </button>
          <button id="tb-maximize" class="ny-shell__window-button" type="button" title="Maximize" aria-label="Maximize" data-i18n-title="shell.maximize" data-i18n-aria-label="shell.maximize" data-window-control>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path fill="currentColor" d="M2.5 2.5h7v7h-7zm1.25 1.25v4.5h4.5v-4.5z" />
            </svg>
          </button>
          <button id="tb-close" class="ny-shell__window-button ny-shell__window-button--close" type="button" title="Close" aria-label="Close" data-i18n-title="shell.close" data-i18n-aria-label="shell.close" data-window-control>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path fill="currentColor" d="M3.03 2L6 4.97 8.97 2 10 3.03 7.03 6 10 8.97 8.97 10 6 7.03 3.03 10 2 8.97 4.97 6 2 3.03z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="ny-shell__body">
      <div id="editor-container"></div>
    </div>

    <div id="statusbar">
      <div class="ny-shell__status-group">
        <span id="sb-words" class="ny-shell__status">0 words</span>
        <span id="sb-lines" class="ny-shell__status">Line 1</span>
      </div>
      <div class="ny-shell__status-group">
        <span id="sb-theme" class="ny-shell__action">${initialThemeLabel}</span>
        <span id="sb-mode" class="ny-shell__action">Markdown</span>
      </div>
    </div>
  `;

  if (isLinux) bindLinuxResizeHandles(host);
}
