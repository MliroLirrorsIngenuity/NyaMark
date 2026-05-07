import { getPlatform } from '../platform/detect';

export { registerShellStyles } from './shell.css';

export function renderAppShell(host: HTMLElement) {
  const platformClass = getPlatform();
  const isMac = platformClass === 'macos';
  const initialThemeLabel = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light';
  const newShortcutHint = isMac ? '⌘N' : 'Ctrl+N';
  const openShortcutHint = isMac ? '⌘O' : 'Ctrl+O';
  const saveShortcutHint = isMac ? '⌘S' : 'Ctrl+S';
  const outlineShortcutHint = isMac ? '⌘⇧O' : 'Ctrl+Shift+O';

  host.className = `ny-editor-root ny-shell ny-shell--${platformClass}`;
  host.innerHTML = `
    <div id="titlebar" data-tauri-drag-region>
      <div class="ny-shell__title-leading">
        <div class="ny-shell__title-quick-actions">
          <button id="tb-new" class="ny-shell__shortcut-button" type="button" title="New file" aria-label="New file">
            <span class="ny-shell__shortcut-label">New</span>
            <span class="ny-shell__shortcut-hint">${newShortcutHint}</span>
          </button>
          <button id="tb-open" class="ny-shell__shortcut-button" type="button" title="Open file" aria-label="Open file">
            <span class="ny-shell__shortcut-label">Open</span>
            <span class="ny-shell__shortcut-hint">${openShortcutHint}</span>
          </button>
          <button id="tb-save" class="ny-shell__shortcut-button" type="button" title="Save file" aria-label="Save file">
            <span class="ny-shell__shortcut-label">Save</span>
            <span class="ny-shell__shortcut-hint">${saveShortcutHint}</span>
          </button>
        </div>
      </div>
      <div class="ny-shell__title-center">
        <div id="tb-filename" class="ny-shell__filename">Untitled.md</div>
        <span id="tb-dirty" class="ny-shell__dirty">●</span>
      </div>
      <div class="ny-shell__title-actions">
        <div class="ny-shell__title-meta">
          <div class="ny-shell__title-quick-actions">
            <button id="tb-settings" class="ny-shell__shortcut-button ny-shell__settings-button" type="button" title="Settings" aria-label="Settings">
              <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
                <path fill="currentColor" d="M9.405 1.05c-.413-.014-1.397-.014-1.81 0a.75.75 0 0 0-.707.62l-.18 1.07a5.25 5.25 0 0 0-1.225.71L4.5 3.18a.75.75 0 0 0-.92.33l-.91 1.55a.75.75 0 0 0 .15.94l.81.74a5.27 5.27 0 0 0 0 1.4l-.81.74a.75.75 0 0 0-.15.94l.91 1.55a.75.75 0 0 0 .92.33l.99-.27c.37.3.78.54 1.22.71l.18 1.07a.75.75 0 0 0 .71.62c.41.014 1.4.014 1.81 0a.75.75 0 0 0 .71-.62l.18-1.07a5.27 5.27 0 0 0 1.22-.71l.99.27a.75.75 0 0 0 .92-.33l.91-1.55a.75.75 0 0 0-.15-.94l-.81-.74a5.3 5.3 0 0 0 0-1.4l.81-.74a.75.75 0 0 0 .15-.94l-.91-1.55a.75.75 0 0 0-.92-.33l-.99.27a5.25 5.25 0 0 0-1.22-.71L10.115 1.67a.75.75 0 0 0-.71-.62ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>
              </svg>
            </button>
            <button id="tb-outline" class="ny-shell__shortcut-button" type="button" title="Toggle outline" aria-label="Toggle outline">
              <span class="ny-shell__shortcut-label">Outline</span>
              <span class="ny-shell__shortcut-hint">${outlineShortcutHint}</span>
            </button>
          </div>
        </div>
        <div class="ny-shell__window-controls" aria-label="Window controls">
          <button id="tb-minimize" class="ny-shell__window-button" type="button" title="Minimize" aria-label="Minimize" data-window-control>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path fill="currentColor" d="M2 5.25h8v1.5H2z" />
            </svg>
          </button>
          <button id="tb-maximize" class="ny-shell__window-button" type="button" title="Maximize" aria-label="Maximize" data-window-control>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path fill="currentColor" d="M2.5 2.5h7v7h-7zm1.25 1.25v4.5h4.5v-4.5z" />
            </svg>
          </button>
          <button id="tb-close" class="ny-shell__window-button ny-shell__window-button--close" type="button" title="Close" aria-label="Close" data-window-control>
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
}
