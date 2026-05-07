import { ensureStyle } from '../../style/register';

const css = `
.ny-editor-root .milkdown .milkdown-image-block .image-edit,
.ny-editor-root .milkdown .milkdown-image-block .image-wrapper {
  color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-image-block > .image-wrapper {
  overflow: visible !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta-toggle {
  position: absolute !important;
  right: 12px !important;
  bottom: 12px !important;
  z-index: 4 !important;
  padding: 6px 10px !important;
  border: 1px solid var(--ny-editor-button-border) !important;
  border-radius: 999px !important;
  background: color-mix(in srgb, var(--ny-editor-floating-bg), transparent 4%) !important;
  color: var(--ny-editor-button-text) !important;
  backdrop-filter: blur(14px) !important;
  -webkit-backdrop-filter: blur(14px) !important;
  box-shadow: var(--ny-editor-floating-shadow) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  font-weight: 650 !important;
  letter-spacing: 0.01em !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transform: translateY(4px) scale(0.96) !important;
  -webkit-user-drag: none !important;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease !important;
}

.ny-editor-root .milkdown .milkdown-image-block:hover .nyamark-image-meta-toggle,
.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta-toggle:hover,
.ny-editor-root .milkdown .milkdown-image-block.nyamark-image-meta-open .nyamark-image-meta-toggle {
  opacity: 0.96 !important;
  pointer-events: auto !important;
  transform: translateY(0) scale(1) !important;
  color: var(--ny-editor-text-primary) !important;
  border-color: color-mix(in srgb, var(--ny-editor-button-border), white 8%) !important;
  background: var(--ny-editor-floating-bg) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta {
  display: grid !important;
  gap: 8px !important;
  position: absolute !important;
  top: calc(100% + 10px) !important;
  right: 0 !important;
  z-index: 5 !important;
  width: min(420px, calc(100vw - 48px)) !important;
  margin: 0 !important;
  padding: 0 12px !important;
  max-width: none !important;
  max-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transform: translateY(-8px) scale(0.98) !important;
  transform-origin: top right !important;
  border: 1px solid transparent !important;
  border-radius: 18px !important;
  background: var(--ny-editor-panel-bg) !important;
  box-shadow: none !important;
  -webkit-user-drag: none !important;
  transition:
    max-height 0.18s ease,
    opacity 0.15s ease,
    padding 0.18s ease,
    margin 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease !important;
}

.ny-editor-root .milkdown .milkdown-image-block.nyamark-image-meta-open > .image-wrapper .nyamark-image-meta {
  padding: 10px 12px !important;
  max-height: 180px !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: translateY(0) scale(1) !important;
  border-color: var(--ny-editor-panel-border) !important;
  box-shadow:
    0 20px 48px rgba(15, 23, 42, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__field {
  display: grid !important;
  gap: 6px !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__label {
  font-size: 10px !important;
  line-height: 1.2 !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  color: var(--ny-editor-button-text) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__input {
  width: 100% !important;
  min-width: 0 !important;
  padding: 8px 10px !important;
  border: 1px solid var(--ny-editor-button-border) !important;
  border-radius: 10px !important;
  outline: none !important;
  background: var(--ny-editor-floating-bg) !important;
  color: var(--ny-editor-text-primary) !important;
  caret-color: var(--ny-editor-text-primary) !important;
  cursor: text !important;
  -webkit-user-drag: none !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__input:focus {
  border-color: color-mix(in srgb, var(--nyamark-accent), transparent 35%) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nyamark-accent), transparent 82%) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__input::placeholder {
  color: var(--ny-editor-button-text) !important;
  opacity: 1 !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__input--caption {
  font-size: 13px !important;
  line-height: 1.35 !important;
  font-weight: 520 !important;
}

.ny-editor-root .milkdown .milkdown-image-block .nyamark-image-meta__input--path {
  font-family: var(--ny-font-mono) !important;
  font-size: 11px !important;
  line-height: 1.35 !important;
  color: var(--ny-editor-chip-text) !important;
  background: color-mix(in srgb, var(--ny-editor-floating-bg), var(--ny-editor-codeblock-bg) 28%) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .link-importer {
  border: 1px solid var(--ny-editor-panel-border) !important;
  background: var(--ny-editor-panel-bg) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .link-importer.focus {
  border-color: color-mix(in srgb, var(--nyamark-accent), transparent 35%) !important;
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--nyamark-accent), transparent 82%),
    inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .link-input-area,
.ny-editor-root .milkdown .milkdown-image-block .caption-input {
  color: var(--ny-editor-text-primary) !important;
  caret-color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .link-input-area::placeholder,
.ny-editor-root .milkdown .milkdown-image-block .caption-input::placeholder,
.ny-editor-root .milkdown .milkdown-image-block .placeholder,
.ny-editor-root .milkdown .milkdown-image-block .placeholder .text {
  color: var(--ny-editor-button-text) !important;
  opacity: 1 !important;
}

.ny-editor-root .milkdown .milkdown-image-block .placeholder .uploader,
.ny-editor-root .milkdown .milkdown-image-block .confirm {
  color: var(--ny-editor-button-text) !important;
}

.ny-editor-root .milkdown .milkdown-image-block .placeholder .uploader:hover,
.ny-editor-root .milkdown .milkdown-image-block .confirm:hover {
  color: var(--ny-editor-text-primary) !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .caption-input,
:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .link-input-area {
  color: #edf3f8 !important;
}

:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .placeholder,
:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .placeholder .text,
:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .confirm,
:root[data-theme="dark"] .ny-editor-root .milkdown .milkdown-image-block .image-icon {
  color: #b5c1cf !important;
}
`;

export function registerImageMetaStyles() {
  ensureStyle('editor-image-meta', css);
}
