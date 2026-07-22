import { ensureStyle } from '../../style/register';

const css = `
/*
 * Inline code. Crepe's reset makes it an \`inline-block\` at 87.5% with its own
 * line-height, so the chip becomes taller than the line it sits in and pushes
 * the surrounding text apart. Render it as a real inline run instead: the
 * background box then stays inside the line box and the code reads as part of
 * the sentence rather than a widget dropped on top of it.
 */
.ny-editor-root .milkdown .ProseMirror code {
  display: inline !important;
  font-family: var(--ny-font-mono) !important;
  font-size: 0.9em !important;
  line-height: inherit !important;
  color: var(--crepe-color-inline-code) !important;
  border-radius: 4px !important;
  background: var(--ny-editor-inline-code-bg) !important;
  border: 0 !important;
  padding: 0.14em 0.34em !important;
  margin: 0 0.06em !important;
  overflow-wrap: break-word !important;
}

.ny-editor-root .milkdown .ProseMirror pre code {
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  font-size: inherit !important;
}

.ny-editor-root .milkdown .ProseMirror a {
  color: var(--nyamark-accent) !important;
  text-decoration-color: color-mix(in srgb, var(--nyamark-accent), transparent 62%) !important;
  text-decoration-thickness: 1px !important;
  text-underline-offset: 0.18em !important;
}

/*
 * Crepe's reset gives paragraphs \`padding: 4px 0\` and headings \`padding: 2px 0\`
 * on top of whatever margins we set, so every block carries two independent
 * spacing systems. Zero the padding and drive the rhythm from margins alone.
 */
.ny-editor-root .milkdown .ProseMirror p,
.ny-editor-root .milkdown .ProseMirror h1,
.ny-editor-root .milkdown .ProseMirror h2,
.ny-editor-root .milkdown .ProseMirror h3,
.ny-editor-root .milkdown .ProseMirror h4,
.ny-editor-root .milkdown .ProseMirror h5,
.ny-editor-root .milkdown .ProseMirror h6 {
  padding: 0 !important;
}

.ny-editor-root .milkdown .ProseMirror blockquote {
  padding-left: 1.05em !important;
}

.ny-editor-root .milkdown .ProseMirror blockquote::before {
  width: 2px !important;
  top: 0.16em !important;
  bottom: 0.16em !important;
  border-radius: 2px !important;
  background: var(--ny-editor-quote-bar) !important;
}

.ny-editor-root .milkdown .ProseMirror hr {
  height: 1px !important;
  padding: 0 !important;
  margin: 1.15em 0 !important;
  background-color: var(--ny-editor-rule) !important;
}

.milkdown {
  box-shadow: none !important;
  background: transparent !important;
}

.milkdown .editor {
  width: min(calc(100% - 104px), var(--ny-editor-readable-max)) !important;
  max-width: 100% !important;
  margin: 0 auto !important;
  padding: 0 !important;
}

.ny-editor-root .milkdown .ProseMirror {
  font-family: var(--ny-font-sans) !important;
  color: var(--ny-editor-text-primary) !important;
  font-size: inherit !important;
  line-height: inherit !important;
  letter-spacing: -0.01em;
}

.ny-editor-root .milkdown .ProseMirror p,
.ny-editor-root .milkdown .ProseMirror li,
.ny-editor-root .milkdown .ProseMirror blockquote {
  font-size: inherit !important;
  line-height: inherit !important;
}

.ny-editor-root .milkdown .ProseMirror h1,
.ny-editor-root .milkdown .ProseMirror h2,
.ny-editor-root .milkdown .ProseMirror h3,
.ny-editor-root .milkdown .ProseMirror h4,
.ny-editor-root .milkdown .ProseMirror h5,
.ny-editor-root .milkdown .ProseMirror h6 {
  font-family: var(--ny-font-sans);
  font-weight: 760;
  letter-spacing: -0.045em;
  color: var(--ny-editor-heading);
  scroll-margin-top: 100px !important;
}

.ny-editor-root .milkdown .ProseMirror h1 {
  font-size: 1.72em !important;
  line-height: 1.12 !important;
  margin: 0.88em 0 0.26em !important;
}

.ny-editor-root .milkdown .ProseMirror h2 {
  font-size: 1.43em !important;
  line-height: 1.16 !important;
  margin: 0.92em 0 0.24em !important;
}

.ny-editor-root .milkdown .ProseMirror h3 {
  font-size: 1.22em !important;
  line-height: 1.2 !important;
  margin: 0.88em 0 0.22em !important;
}

.ny-editor-root .milkdown .ProseMirror h4 {
  font-size: 1.08em !important;
  line-height: 1.2 !important;
  margin: 0.84em 0 0.2em !important;
}

.ny-editor-root .milkdown .ProseMirror table {
  table-layout: fixed !important;
  width: 100% !important;
}

.ny-editor-root .milkdown .ProseMirror th,
.ny-editor-root .milkdown .ProseMirror td {
  min-width: 0 !important;
  vertical-align: top !important;
}

.ny-editor-root .milkdown .ProseMirror th code,
.ny-editor-root .milkdown .ProseMirror td code {
  display: inline !important;
  white-space: normal !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
}

/*
 * Block rhythm. Every value below is in \`em\` so the whole document rescales
 * with the reader's font-size setting instead of drifting apart from it.
 */
.ny-editor-root .milkdown .editor p {
  margin: 0.72em 0 !important;
}

.ny-editor-root .milkdown .editor ul,
.ny-editor-root .milkdown .editor ol,
.ny-editor-root .milkdown .editor blockquote {
  margin: 0.72em 0 !important;
}

/*
 * Every block-level node view ships its own margin (4px for tables and
 * images, 0.5rem for code blocks), so the document gap changes depending on
 * which node happens to be next. Put them all on the paragraph gap.
 */
.ny-editor-root .milkdown .editor .milkdown-table-block,
.ny-editor-root .milkdown .editor .milkdown-image-block,
.ny-editor-root .milkdown .editor .milkdown-code-block {
  margin: 0.72em 0 !important;
}

.ny-editor-root .milkdown .editor > *:first-child {
  margin-top: 0 !important;
}

.ny-editor-root .milkdown .editor > *:last-child {
  margin-bottom: 0 !important;
}

.ny-editor-root .milkdown .editor blockquote > *:first-child {
  margin-top: 0 !important;
}

.ny-editor-root .milkdown .editor blockquote > *:last-child {
  margin-bottom: 0 !important;
}

/*
 * Lists. Crepe renders each item as
 * div.milkdown-list-item-block > li.list-item > (.label-wrapper + .children)
 * with a hard-coded 24px marker column, a 10px gap and a 32px tall label box
 * holding a 24px Material icon — three fixed pixel values that ignore the
 * text metrics, which is why the markers read as loose furniture sitting next
 * to the paragraph instead of belonging to it.
 *
 * Everything here is re-expressed against the text: the marker column is
 * 1.35em wide, the gap 0.4em, and the label box is exactly one line tall and
 * offset by the same margin as the item's first paragraph, so the marker
 * shares that line's box and its optical centre.
 */
.ny-editor-root .milkdown .editor ul,
.ny-editor-root .milkdown .editor ol {
  padding-left: 0 !important;
}

/*
 * Row spacing lives on the item wrapper, never on the paragraph inside it.
 * The item's content sits in a flex item, which is its own block formatting
 * context, so any margin there is trapped: it cannot collapse with the row
 * above or with the list's own margin, and the list ends up a few pixels
 * taller than every other block. Keeping the inner paragraph at zero makes a
 * row exactly one line tall and lets one value own the gap between rows.
 */
.ny-editor-root .milkdown .editor .content-dom > p {
  margin: 0 !important;
}

.ny-editor-root .milkdown .editor .content-dom > p + p {
  margin-top: 0.45em !important;
}

.ny-editor-root .milkdown .editor .content-dom > ul,
.ny-editor-root .milkdown .editor .content-dom > ol {
  margin: 0.3em 0 0 !important;
}

.ny-editor-root .milkdown .editor .milkdown-list-item-block
  + .milkdown-list-item-block {
  margin-top: 0.3em !important;
}

.ny-editor-root .milkdown .editor li.list-item {
  gap: 0.4em !important;
  align-items: flex-start !important;
}

.ny-editor-root .milkdown .editor li.list-item > .label-wrapper {
  width: 1.35em !important;
  height: calc(var(--ny-editor-line-height, 1.52) * 1em) !important;
  margin-top: 0 !important;
  align-items: center !important;
  color: var(--ny-editor-marker) !important;
}

.ny-editor-root .milkdown .editor li.list-item > .label-wrapper > .label {
  position: relative !important;
  width: 100% !important;
  height: auto !important;
  padding: 0 !important;
  line-height: inherit !important;
}

/* The Material icons are replaced by marks drawn from the text's own em box. */
.ny-editor-root .milkdown .editor li.list-item > .label-wrapper > .label svg {
  display: none !important;
}

.ny-editor-root .milkdown .editor .label.bullet::before {
  content: "" !important;
  width: 0.36em !important;
  height: 0.36em !important;
  border-radius: 50% !important;
  background: currentColor !important;
}

/* Depth is signalled the way print does it: filled, hollow, then square. */
.ny-editor-root .milkdown .editor ul ul .label.bullet::before {
  width: 0.42em !important;
  height: 0.42em !important;
  background: transparent !important;
  box-shadow: inset 0 0 0 1.3px currentColor !important;
}

.ny-editor-root .milkdown .editor ul ul ul .label.bullet::before {
  width: 0.3em !important;
  height: 0.3em !important;
  border-radius: 1px !important;
  background: currentColor !important;
  box-shadow: none !important;
}

/*
 * Ordered markers are text, so they share the column's centre line with the
 * bullet and the checkbox rather than hanging off its right edge. The extra
 * padding-left cancels the trailing period's side bearing, which would
 * otherwise push the digit a couple of pixels left of that centre line.
 */
.ny-editor-root .milkdown .editor li.list-item > .label-wrapper > .label.ordered {
  display: block !important;
  text-align: center !important;
  padding-left: 0.26em !important;
  font-size: 0.88em !important;
  font-variant-numeric: tabular-nums !important;
  font-feature-settings: "tnum" !important;
  letter-spacing: -0.01em !important;
}

.ny-editor-root .milkdown .editor .label.checked::before,
.ny-editor-root .milkdown .editor .label.unchecked::before {
  content: "" !important;
  width: 0.94em !important;
  height: 0.94em !important;
  border-radius: 0.28em !important;
  box-shadow: inset 0 0 0 1.4px currentColor !important;
  transition: background 0.15s, box-shadow 0.15s !important;
}

.ny-editor-root .milkdown .editor .label.checked::before {
  background: var(--nyamark-accent) !important;
  box-shadow: none !important;
}

.ny-editor-root .milkdown .editor .label.checked::after {
  content: "" !important;
  position: absolute !important;
  inset: 0 !important;
  margin: auto !important;
  width: 0.3em !important;
  height: 0.16em !important;
  border-left: 1.5px solid var(--ny-editor-check-mark) !important;
  border-bottom: 1.5px solid var(--ny-editor-check-mark) !important;
  transform: translateY(-0.06em) rotate(-45deg) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-editor,
.ny-editor-root .milkdown .milkdown-code-block .cm-editor * {
  font-family: var(--ny-font-mono) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar {
  position: sticky !important;
  top: 0.75rem !important;
  z-index: 50 !important;
  display: flex !important;
  justify-content: center !important;
  width: 100% !important;
  max-width: 100% !important;
  margin-top: 0.75rem !important;
  margin-left: auto !important;
  margin-right: auto !important;
  margin-bottom: 0.75rem !important;
  min-height: 40px !important;
  padding: 0 clamp(14px, 1.8vw, 28px) !important;
  border: 1px solid color-mix(in srgb, var(--crepe-color-outline), transparent 40%) !important;
  border-radius: var(--ny-surface-radius) !important;
  background: var(--ny-editor-toolbar-bg) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  box-shadow: var(--ny-editor-toolbar-shadow) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-inner {
  display: flex !important;
  align-items: center !important;
  flex-wrap: nowrap !important;
  justify-content: center !important;
  gap: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 auto !important;
  padding: 0 clamp(8px, 1vw, 18px) !important;
  box-sizing: border-box !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-divider {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 1 1 clamp(16px, 2.8vw, 56px) !important;
  min-width: 16px !important;
  max-width: 56px !important;
  margin: 8px 0 !important;
  background: transparent !important;
  height: 20px !important;
  flex-shrink: 0 !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-divider::before {
  content: "" !important;
  width: 1px !important;
  height: 20px !important;
  background: color-mix(in srgb, var(--crepe-color-outline), transparent 84%) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-selector,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item {
  margin: 0 0.125rem !important;
  flex-shrink: 0 !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-button,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item {
  height: 1.75rem !important;
  border-radius: 0.5rem !important;
  cursor: default !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item {
  width: 1.75rem !important;
  padding: 0.125rem !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item svg {
  width: 1.25rem !important;
  height: 1.25rem !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-button,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-text,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-option {
  font-size: 14px !important;
  line-height: 20px !important;
  cursor: default !important;
}

.ny-editor-root .milkdown .milkdown-toolbar {
  border: 1px solid color-mix(in srgb, var(--crepe-color-outline), transparent 84%) !important;
  border-radius: 10px !important;
  background: var(--ny-editor-floating-bg) !important;
  box-shadow: var(--ny-editor-floating-shadow) !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .divider {
  margin: 8px 4px !important;
  height: 18px !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item {
  width: 1.75rem !important;
  height: 1.75rem !important;
  margin: 0.25rem !important;
  padding: 0.125rem !important;
  border-radius: 0.5rem !important;
  cursor: default !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item svg {
  width: 1.25rem !important;
  height: 1.25rem !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item.active,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item.active,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-option.active {
  background: var(--nyamark-accent-soft) !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item.active svg,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item.active svg,
.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-option.active {
  color: var(--nyamark-accent) !important;
  fill: var(--nyamark-accent) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-heading-option.active {
  font-weight: 600 !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item svg {
  color: var(--crepe-color-on-surface-variant) !important;
  fill: var(--crepe-color-on-surface-variant) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item:hover svg {
  color: var(--crepe-color-on-surface) !important;
  fill: var(--crepe-color-on-surface) !important;
}

.ny-editor-root .milkdown .milkdown-top-bar .top-bar-item.active svg {
  color: var(--crepe-color-primary) !important;
  fill: var(--crepe-color-primary) !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item svg {
  color: var(--crepe-color-on-surface-variant) !important;
  fill: var(--crepe-color-on-surface-variant) !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item:hover svg {
  color: var(--crepe-color-on-surface) !important;
  fill: var(--crepe-color-on-surface) !important;
}

.ny-editor-root .milkdown .milkdown-toolbar .toolbar-item.active svg {
  color: var(--crepe-color-primary) !important;
  fill: var(--crepe-color-primary) !important;
}

.ny-editor-root .milkdown .milkdown-code-block {
  padding: 0 !important;
  border: 1px solid var(--ny-editor-codeblock-border) !important;
  border-radius: 16px !important;
  overflow: visible !important;
  background: var(--ny-editor-codeblock-bg) !important;
  box-shadow: var(--ny-editor-codeblock-shadow) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools {
  margin: 0 !important;
  display: flex !important;
  align-items: center !important;
  min-height: 34px !important;
  padding: 4px 8px !important;
  position: relative !important;
  z-index: 3 !important;
  overflow: visible !important;
  background: transparent !important;
  border-bottom: none !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .language-button {
  margin: 0 !important;
  height: 26px !important;
  min-height: 26px !important;
  padding: 0 9px 0 10px !important;
  border: 1px solid var(--ny-editor-chip-border) !important;
  border-radius: 13px !important;
  background: color-mix(in srgb, var(--ny-editor-chip-bg), transparent 12%) !important;
  color: var(--ny-editor-chip-text) !important;
  opacity: 1 !important;
  cursor: default !important;
  font-size: 11px !important;
  line-height: 1 !important;
  font-weight: 500 !important;
  box-shadow: none !important;
  transition: background 0.15s, border-color 0.15s, color 0.15s !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .language-button:hover {
  background: var(--ny-editor-floating-bg) !important;
  border-color: color-mix(in srgb, var(--ny-editor-chip-border), white 6%) !important;
  color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group {
  gap: 0.25rem !important;
  align-items: center !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group button {
  height: 26px !important;
  min-height: 26px !important;
  padding: 0 10px !important;
  border: 1px solid var(--ny-editor-button-border) !important;
  border-radius: 13px !important;
  background: color-mix(in srgb, var(--ny-editor-button-bg), transparent 10%) !important;
  color: var(--ny-editor-button-text) !important;
  opacity: 1 !important;
  cursor: default !important;
  font-size: 11px !important;
  line-height: 1 !important;
  font-weight: 500 !important;
  box-shadow: none !important;
  transition: background 0.15s, color 0.15s, border-color 0.15s !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group button:hover {
  background: var(--ny-editor-floating-bg) !important;
  border-color: color-mix(in srgb, var(--ny-editor-button-border), white 6%) !important;
  color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .codemirror-host {
  margin: 0 !important;
  border: 0 !important;
  border-top: 1px solid var(--ny-editor-panel-border) !important;
  border-radius: 0 0 16px 16px !important;
  overflow: hidden !important;
  background: transparent !important;
  box-shadow: none !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-editor {
  margin: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
  font-size: 13px !important;
  line-height: 1.35 !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-gutters {
  background: color-mix(in srgb, var(--ny-editor-gutter-bg), transparent 20%) !important;
  color: var(--ny-editor-gutter-text) !important;
  border-right: 1px solid var(--ny-editor-panel-border) !important;
  font-size: 12px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-content {
  padding-top: 0 !important;
  padding-bottom: 0.2rem !important;
  caret-color: var(--ny-editor-text-primary);
}

/*
 * Provide a fallback color for code lines that DON'T have a Lezer
 * highlight style (e.g. unknown languages). When @codemirror/language-data
 * loads a parser, syntax tokens supply their own color via inner spans
 * so this rule never wins for highlighted code.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-line {
  color: var(--ny-editor-code-text);
}

.ny-editor-root .milkdown .milkdown-code-block .cm-activeLine,
.ny-editor-root .milkdown .milkdown-code-block .cm-activeLineGutter {
  background: var(--ny-editor-active-line) !important;
}

/*
 * Ensure the gutter (line numbers + fold) is always laid out by basicSetup.
 * Some upstream resets/global :has() rules can collapse it; pin a min-width
 * so the line number column stays visible even when CodeMirror temporarily
 * has nothing rendered yet.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-gutters {
  min-width: 32px;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-gutterElement {
  padding: 0 8px 0 6px !important;
  min-width: 1.5em;
}

.ny-editor-root .milkdown .milkdown-code-block .preview-panel {
  padding: 0 !important;
  border-top: 1px solid var(--ny-editor-panel-border) !important;
  background: transparent !important;
  border-radius: 0 0 16px 16px !important;
  overflow: hidden !important;
}

.ny-editor-root .milkdown .milkdown-code-block .preview-panel .preview-divider,
.ny-editor-root .milkdown .milkdown-code-block .preview-panel .preview-label {
  display: none !important;
}

.ny-editor-root .milkdown .milkdown-code-block .preview-panel .preview {
  min-height: 132px;
  padding: 10px 12px 12px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.ny-editor-root .milkdown .milkdown-code-block .language-picker {
  position: absolute !important;
  top: calc(100% - 2px) !important;
  left: 0 !important;
  width: max-content !important;
  padding-top: 4px !important;
  z-index: 30 !important;
}

.ny-editor-root .milkdown .milkdown-code-block .list-wrapper {
  width: 188px !important;
  padding-top: 8px !important;
  border: 1px solid var(--ny-editor-button-border) !important;
  border-radius: 14px !important;
  background: color-mix(in srgb, var(--ny-editor-floating-bg), transparent 4%) !important;
  backdrop-filter: blur(18px) !important;
  -webkit-backdrop-filter: blur(18px) !important;
  box-shadow: var(--ny-editor-floating-shadow) !important;
  overflow: hidden !important;
  pointer-events: auto !important;
}

.ny-editor-root .milkdown .milkdown-code-block .language-list {
  height: 196px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .language-list-item {
  gap: 6px !important;
  padding: 3px 12px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  line-height: 16px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .language-list-item .leading,
.ny-editor-root .milkdown .milkdown-code-block .language-list-item .leading svg {
  width: 16px !important;
  height: 16px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .search-box {
  margin: 0 8px 6px !important;
  gap: 6px !important;
  padding: 4px 8px !important;
  border: 1px solid color-mix(in srgb, var(--nyamark-accent), transparent 58%) !important;
  border-radius: 10px !important;
  outline: none !important;
  background: color-mix(in srgb, var(--ny-editor-floating-bg), transparent 8%) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .search-box:has(input:focus) {
  border-color: color-mix(in srgb, var(--nyamark-accent), transparent 35%) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--nyamark-accent), transparent 84%) !important;
  outline: none !important;
}

.ny-editor-root .milkdown .milkdown-code-block .search-box input,
.ny-editor-root .milkdown .milkdown-code-block .search-box .search-input {
  font-size: 12px !important;
  line-height: 16px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .search-box .clear-icon,
.ny-editor-root .milkdown .milkdown-code-block .search-box .clear-icon svg {
  width: 16px !important;
  height: 16px !important;
}

.ny-editor-root .milkdown .milkdown-top-bar,
.ny-editor-root .milkdown .milkdown-toolbar,
.ny-editor-root .milkdown .milkdown-slash-menu,
.ny-editor-root .milkdown .milkdown-block-handle,
.ny-editor-root .milkdown .milkdown-code-block .language-selector,
.ny-editor-root .milkdown .milkdown-code-block button {
  user-select: none !important;
  -webkit-user-select: none !important;
}

.milkdown-toolbar {
  z-index: 500 !important;
}
`;

export function registerCrepeOverrideStyles() {
  ensureStyle('editor-crepe-overrides', css);
}
