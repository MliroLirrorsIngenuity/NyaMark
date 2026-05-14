import { ensureStyle } from '../style/register';

const shellStyles = `
:root {
  --ny-font-sans: "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
  --ny-font-mono: "SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace;
  --ny-surface-radius: 24px;
  --ny-toolbar-frame-max: 1440px;
  --ny-editor-font-size: 14px;
  --ny-editor-line-height: 1.52;
  --ny-editor-readable-max: 1120px;
  --ny-window-controls-space: 0px;
  --ny-accent: #4d7a8f;
  --ny-accent-soft: #ecf4f7;
  --ny-app-bg-start: #fffefb;
  --ny-app-bg-end: #ffffff;
  --ny-surface-elevated: rgba(255, 255, 255, 0.96);
  --ny-surface-muted: rgba(255, 255, 255, 0.72);
  --ny-surface-ghost: rgba(250, 250, 249, 0.9);
  --ny-titlebar-bg: rgba(255, 255, 255, 0.86);
  --ny-statusbar-bg: rgba(255, 255, 255, 0.94);
  --ny-border-soft: rgba(226, 232, 240, 0.5);
  --ny-border-strong: rgba(226, 232, 240, 0.72);
  --ny-border-button: rgba(214, 220, 229, 0.88);
  --ny-border-button-hover: rgba(197, 205, 216, 0.96);
  --ny-text-primary: #17212b;
  --ny-text-secondary: #6b7280;
  --ny-text-muted: #8b95a3;
  --ny-text-quiet: #727b88;
  --ny-kbd-bg: rgba(236, 244, 247, 0.92);
  --ny-kbd-border: rgba(214, 230, 235, 0.96);
  --ny-kbd-text: #53758a;
  --ny-warning: #d97706;
  --ny-shadow-float: 0 16px 40px rgba(15, 23, 42, 0.12);
}

:root[data-theme="dark"] {
  --ny-accent: #8db4c8;
  --ny-accent-soft: rgba(96, 135, 158, 0.18);
  --ny-app-bg-start: #10151b;
  --ny-app-bg-end: #131a22;
  --ny-surface-elevated: rgba(24, 31, 41, 0.96);
  --ny-surface-muted: rgba(21, 28, 36, 0.78);
  --ny-surface-ghost: rgba(20, 27, 35, 0.92);
  --ny-titlebar-bg: rgba(19, 25, 33, 0.82);
  --ny-statusbar-bg: rgba(17, 23, 31, 0.94);
  --ny-border-soft: rgba(119, 134, 155, 0.16);
  --ny-border-strong: rgba(132, 148, 170, 0.25);
  --ny-border-button: rgba(101, 117, 139, 0.28);
  --ny-border-button-hover: rgba(127, 145, 168, 0.38);
  --ny-text-primary: #edf3f8;
  --ny-text-secondary: #c7d0db;
  --ny-text-muted: #91a0b2;
  --ny-text-quiet: #a7b4c4;
  --ny-kbd-bg: rgba(74, 101, 122, 0.24);
  --ny-kbd-border: rgba(101, 129, 150, 0.34);
  --ny-kbd-text: #c6dce8;
  --ny-warning: #f3ba67;
  --ny-shadow-float: 0 20px 48px rgba(0, 0, 0, 0.38);
}

:root[data-platform="linux"] .ny-editor-root .milkdown {
  --ny-editor-toolbar-bg: var(--ny-window-toolbar-bg, rgba(255, 255, 255, 0.78));
  --ny-editor-floating-bg: var(--ny-window-floating-bg, rgba(255, 255, 255, 0.88));
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

html,
body {
  padding: 0;
  overflow: hidden;
  background: transparent;
  color: var(--ny-text-primary);
  font-family: var(--ny-font-sans);
}

body {
  min-height: 100vh;
}

#app {
  min-height: 100vh;
}

#app.ny-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--ny-surface-radius);
  background: linear-gradient(180deg, var(--ny-app-bg-start) 0%, color-mix(in srgb, var(--ny-app-bg-start), var(--ny-app-bg-end) 42%) 38%, var(--ny-app-bg-end) 100%);
  color: var(--ny-text-primary);
}

/* Transparency overrides - MUST be defined after the base background to win */
:root.ny-shell--transparent #app.ny-shell {
  background: transparent !important;
}

:root.ny-shell--transparent {
  --ny-surface-elevated: rgba(255, 255, 255, 0.72);
  --ny-surface-muted: rgba(255, 255, 255, 0.52);
  --ny-surface-ghost: rgba(255, 255, 255, 0.36);
  --ny-titlebar-bg: transparent;
  --ny-statusbar-bg: transparent;
}

:root[data-theme="dark"].ny-shell--transparent #app.ny-shell {
  background: transparent !important;
}

:root[data-theme="dark"].ny-shell--transparent {
  --ny-surface-elevated: rgba(15, 23, 42, 0.72);
  --ny-surface-muted: rgba(15, 23, 42, 0.52);
  --ny-surface-ghost: rgba(15, 23, 42, 0.36);
}

:root[data-platform="windows"].ny-shell--transparent #titlebar {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

#app.ny-shell--macos {
  --ny-window-controls-space: 78px;
  border-radius: 0;
}

#app.ny-shell--windows,
#app.ny-shell--linux {
  border-radius: 0;
}

#app.ny-shell--linux {
  border-radius: 0;
}

.ny-shell__resize-handle {
  position: fixed;
  z-index: 220;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.ny-shell__resize-handle--n,
.ny-shell__resize-handle--s {
  left: 18px;
  right: 18px;
  height: 6px;
  cursor: ns-resize;
}

.ny-shell__resize-handle--n {
  top: 0;
}

.ny-shell__resize-handle--s {
  bottom: 0;
}

.ny-shell__resize-handle--e,
.ny-shell__resize-handle--w {
  top: 18px;
  bottom: 18px;
  width: 6px;
  cursor: ew-resize;
}

.ny-shell__resize-handle--e {
  right: 0;
}

.ny-shell__resize-handle--w {
  left: 0;
}

.ny-shell__resize-handle--nw,
.ny-shell__resize-handle--ne,
.ny-shell__resize-handle--sw,
.ny-shell__resize-handle--se {
  width: 18px;
  height: 18px;
}

.ny-shell__resize-handle--nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.ny-shell__resize-handle--ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.ny-shell__resize-handle--sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.ny-shell__resize-handle--se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}

#titlebar {
  height: 40px;
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--ny-border-soft);
  background: var(--ny-titlebar-bg) !important;
  border-bottom-color: var(--ny-border-strong) !important;
  color: var(--ny-text-quiet) !important;
  font-size: 14px;
  backdrop-filter: blur(18px) saturate(1.35) !important;
  -webkit-backdrop-filter: blur(18px) saturate(1.35) !important;
  z-index: 1000;
}

.ny-shell__title-leading {
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.ny-shell__title-leading .ny-shell__title-quick-actions {
  padding-left: var(--ny-window-controls-space);
}

.ny-shell--macos .ny-shell__title-leading {
  min-width: var(--ny-window-controls-space);
}

.ny-shell--macos .ny-shell__title-leading .ny-shell__title-quick-actions {
  display: none;
}

.ny-shell__title-center {
  position: absolute;
  left: 50%;
  top: 50%;
  display: inline-flex;
  align-items: center;
  max-width: min(52vw, 420px);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.ny-shell__filename {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  text-align: center;
}

.ny-shell__title-actions,
.ny-shell__title-meta,
.ny-shell__status-group {
  display: flex;
  align-items: center;
}

.ny-shell__title-actions,
.ny-shell__status-group {
  gap: 16px;
}

.ny-shell__title-actions {
  gap: 10px;
  margin-left: auto;
  position: relative;
  z-index: 1;
}

.ny-shell__title-meta {
  gap: 10px;
  flex-shrink: 0;
}

.ny-shell__title-quick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
}

.ny-shell__file-menu {
  position: relative;
}

.ny-shell__shortcut-button {
  appearance: none;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(214, 220, 229, 0.88);
  border-radius: 999px;
  background: var(--ny-surface-muted);
  border-color: var(--ny-border-button);
  color: var(--ny-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: default;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.ny-shell__shortcut-button:hover {
  background: var(--ny-surface-elevated);
  border-color: var(--ny-border-button-hover);
  color: var(--ny-text-primary);
}

.ny-shell__shortcut-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ny-accent), transparent 72%);
  outline-offset: 1px;
}

.ny-shell__shortcut-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.ny-shell__shortcut-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ny-kbd-bg);
  border: 1px solid var(--ny-kbd-border);
  color: var(--ny-kbd-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.ny-shell__menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 188px;
  padding: 8px;
  border: 1px solid var(--ny-border-strong);
  border-radius: 16px;
  background: var(--ny-surface-elevated);
  box-shadow: var(--ny-shadow-float);
  display: grid;
  gap: 4px;
}

.ny-shell__menu[hidden] {
  display: none;
}

.ny-shell__menu-item {
  appearance: none;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ny-text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font: inherit;
  cursor: default;
}

.ny-shell__menu-item:hover {
  background: var(--ny-accent-soft);
  color: var(--ny-text-primary);
}

.ny-shell__menu-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ny-accent), transparent 72%);
  outline-offset: 1px;
}

.ny-shell__window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ny-shell--macos .ny-shell__window-controls {
  display: none;
}

.ny-shell__settings-button {
  width: 30px;
  padding: 0;
  justify-content: center;
}

.ny-shell--macos .ny-shell__settings-button {
  display: none;
}

.ny-shell__window-button {
  appearance: none;
  width: 30px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--ny-border-button);
  border-radius: 8px;
  background: var(--ny-surface-muted);
  color: var(--ny-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.ny-shell__window-button svg {
  width: 12px;
  height: 12px;
}

.ny-shell__window-button:hover {
  background: var(--ny-surface-elevated);
  border-color: var(--ny-border-button-hover);
  color: var(--ny-text-primary);
}

.ny-shell__window-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ny-accent), transparent 72%);
  outline-offset: 1px;
}

.ny-shell__window-button--close:hover {
  background: color-mix(in srgb, #b42318, transparent 90%);
  border-color: color-mix(in srgb, #b42318, transparent 76%);
  color: color-mix(in srgb, #f97316, white 12%);
}

.ny-shell--windows .ny-shell__window-button {
  width: 34px;
  border-radius: 7px;
}

.ny-shell--linux .ny-shell__window-button {
  width: 32px;
  border-radius: 7px;
}

.ny-shell__title-meta,
.ny-shell__status-group {
  gap: 16px;
}

.ny-shell__shortcut,
.ny-shell__status {
  font-size: 12px;
}

.ny-shell__dirty {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  color: var(--ny-warning);
  font-size: 11px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ny-shell__body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scroll-padding-top: 40px;
}

#editor-container {
  width: 100%;
  max-width: var(--ny-toolbar-frame-max);
  margin: 0 auto;
  padding: 0 24px 64px;
  box-sizing: border-box;
  flex: 1;
  min-height: 100%;
}

#statusbar {
  height: 32px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-sizing: border-box;
  border-top: 1px solid var(--ny-border-soft);
  background: var(--ny-statusbar-bg) !important;
  border-top-color: var(--ny-border-strong) !important;
  color: var(--ny-text-muted) !important;
  font-size: 12px;
}

:is(#titlebar, #statusbar),
:is(#titlebar, #statusbar) * {
  user-select: none;
  -webkit-user-select: none;
}

.ny-shell__action {
  cursor: default;
  transition: color 0.15s ease;
}

.ny-shell__action:hover {
  color: var(--ny-text-primary);
}

@media print {
  @page {
    margin: 16mm;
  }

  html,
  body,
  #app,
  #app.ny-shell {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff !important;
    color: #111 !important;
    border-radius: 0 !important;
  }

  :root.ny-exporting-pdf #titlebar,
  :root.ny-exporting-pdf #statusbar,
  :root.ny-exporting-pdf .ny-shell__resize-handle,
  :root.ny-exporting-pdf .ny-shell__window-controls,
  :root.ny-exporting-pdf .ny-shell__title-leading,
  :root.ny-exporting-pdf .ny-shell__title-actions,
  :root.ny-exporting-pdf .milkdown .toolbar {
    display: none !important;
  }

  :root.ny-exporting-pdf .ny-shell__body,
  :root.ny-exporting-pdf #editor-container,
  :root.ny-exporting-pdf .milkdown,
  :root.ny-exporting-pdf .milkdown .editor,
  :root.ny-exporting-pdf .milkdown .ProseMirror {
    overflow: visible !important;
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  :root.ny-exporting-pdf .milkdown .editor {
    padding-left: 0 !important;
    padding-right: 0 !important;
  }

  :root.ny-exporting-pdf .milkdown pre,
  :root.ny-exporting-pdf .milkdown blockquote,
  :root.ny-exporting-pdf .milkdown table,
  :root.ny-exporting-pdf .milkdown img,
  :root.ny-exporting-pdf .milkdown .mermaid,
  :root.ny-exporting-pdf .milkdown .milkdown-code-block {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  :root.ny-exporting-pdf .nyamark-image-meta,
  :root.ny-exporting-pdf .nyamark-image-meta-toggle,
  :root.ny-exporting-pdf .nyamark-image-meta-open .nyamark-image-meta,
  :root.ny-exporting-pdf .milkdown .milkdown-top-bar,
  :root.ny-exporting-pdf .milkdown .milkdown-toolbar,
  :root.ny-exporting-pdf .milkdown .toolbar,
  :root.ny-exporting-pdf .milkdown .top-bar,
  :root.ny-exporting-pdf .milkdown .milkdown-code-block .tools {
    display: none !important;
  }

  :root.ny-exporting-pdf .milkdown h1,
  :root.ny-exporting-pdf .milkdown h2,
  :root.ny-exporting-pdf .milkdown h3,
  :root.ny-exporting-pdf .milkdown h4,
  :root.ny-exporting-pdf .milkdown h5,
  :root.ny-exporting-pdf .milkdown h6 {
    break-after: avoid;
    page-break-after: avoid;
  }
}
`;

export function registerShellStyles() {
  ensureStyle('app-shell', shellStyles);
}
