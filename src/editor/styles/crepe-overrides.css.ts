import { ensureStyle } from '../../style/register';
import { languageBadgeCss } from './language-badges';

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
  margin: 1.15em 0 0 !important;
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
 *
 * The containers are flex columns, not block flow, and that is a selection
 * decision rather than a layout one. WebKit fills the space between the line
 * boxes of a block-flow container when a selection spans them -- "selection
 * gap filling" -- so every inter-block gap got painted along with the text.
 * Flex and grid containers do not gap-fill (verified against block/flex/grid
 * side by side in WebKit), so the highlight stops at the blocks themselves.
 *
 * The cost is that flex items no longer collapse their margins: a 0.72em
 * bottom next to a 0.72em top would become 1.44em instead of 0.72em. So the
 * rhythm is driven from \`margin-top\` alone and every bottom margin is zeroed
 * below. That reproduces the old collapsed spacing exactly -- with collapsing,
 * the following block's top margin was already the value that won -- and it
 * stays correct for node types this file never enumerates.
 */
.ny-editor-root .milkdown .editor,
.ny-editor-root .milkdown .editor blockquote,
.ny-editor-root .milkdown .editor ul,
.ny-editor-root .milkdown .editor ol,
.ny-editor-root .milkdown .editor .content-dom {
  display: flex !important;
  flex-direction: column !important;
}

.ny-editor-root .milkdown .editor > *,
.ny-editor-root .milkdown .editor blockquote > *,
.ny-editor-root .milkdown .editor ul > *,
.ny-editor-root .milkdown .editor ol > *,
.ny-editor-root .milkdown .editor .content-dom > * {
  /* Long documents must not squeeze their blocks to fit a constrained host. */
  flex: 0 0 auto !important;
  margin-bottom: 0 !important;
}

/*
 * The paragraph gap is padding, not margin, and that is a hit-testing decision
 * rather than a spacing one.
 *
 * A margin lives outside the border box, so the band between two paragraphs
 * belongs to no block at all: \`elementFromPoint\` in it returns the flex
 * container, and WebKit can only answer \`caretRangeFromPoint\` with a *block
 * boundary*. Measured on a 10.08px gap: the top 6px resolve to the end of the
 * paragraph above, the bottom 4px to the start of the one below, and neither
 * looks at the column you clicked. That is "点击中间这个空白位置时光标有概率到
 * 下面那一行的开头处" -- the flip line sits inside a band too thin to aim
 * inside, so identical-looking clicks land in two different places.
 *
 * Inside the border box the same point resolves through the paragraph's inline
 * children and maps to the character under the cursor, exactly like clicking
 * on the text.
 *
 * The rhythm is untouched: every block's bottom spacing is zero, so 0.72em of
 * padding-top sits precisely where 0.72em of margin-top sat. The catch is that
 * each rule which used to cancel the margin now has to cancel the padding too;
 * they are marked "paragraph gap" below.
 */
.ny-editor-root .milkdown .editor p {
  margin: 0 !important;
  padding: 0.72em 0 0 !important;
}

.ny-editor-root .milkdown .editor ul,
.ny-editor-root .milkdown .editor ol,
.ny-editor-root .milkdown .editor blockquote {
  margin: 0.72em 0 0 !important;
}

/* Bottom margins are gone, so the space under a rule has to be asked for. */
.ny-editor-root .milkdown .editor hr + * {
  margin-top: 1.15em !important;
}

/* paragraph gap: this space is the rule's, so the paragraph must not add its own. */
.ny-editor-root .milkdown .editor hr + p {
  padding-top: 0 !important;
}

/*
 * Every block-level node view ships its own margin (4px for tables and
 * images, 0.5rem for code blocks), so the document gap changes depending on
 * which node happens to be next. Put them all on the paragraph gap.
 */
.ny-editor-root .milkdown .editor .milkdown-table-block,
.ny-editor-root .milkdown .editor .milkdown-image-block,
.ny-editor-root .milkdown .editor .milkdown-code-block {
  margin: 0.72em 0 0 !important;
}

/*
 * The first block carries no top margin -- but "first" has to mean the first
 * *block*, not the first DOM child.
 *
 * Crepe puts two caret widgets in the document, and a widget decoration is a
 * real element in the flow's DOM even when it paints absolutely:
 *
 *   - prosemirror-virtual-cursor renders \`Decoration.widget(0, ...)\`, i.e.
 *     child #1 of .editor, and only while \`selection.empty\`.
 *   - the gap cursor renders \`Decoration.widget(selection.head, ...)\`, so it
 *     lands as child #1 wherever the gap is -- top level in front of a leading
 *     code block, or in front of a blockquote's first child.
 *
 * Either one knocks the real first block out of \`:first-child\`, so this rule
 * stops matching and the whole document shifts by one paragraph margin, then
 * shifts back when the widget goes away. With the virtual cursor that happens
 * on every single selection/deselection -- 10.08px each way, measured -- which
 * is the "仅仅只是选中和不选中就会出现抖动" report. It needs no code block to
 * happen. The gap cursor is the same bug reached by arrowing into a gap.
 *
 * Matching each widget's successor pins the spacing across all of those
 * states. The two can never both be present: one needs a text selection, the
 * other a GapCursor selection.
 */
.ny-editor-root .milkdown .editor > *:first-child,
.ny-editor-root .milkdown .editor > .prosemirror-virtual-cursor + *,
.ny-editor-root .milkdown .editor > .ProseMirror-gapcursor + * {
  margin-top: 0 !important;
}

/*
 * paragraph gap: the same three cases. Kept separate and typed to \`p\` because
 * the blocks that are not paragraphs need their own padding -- a code block
 * opening the document would lose the inset its card is drawn with.
 */
.ny-editor-root .milkdown .editor > p:first-child,
.ny-editor-root .milkdown .editor > .prosemirror-virtual-cursor + p,
.ny-editor-root .milkdown .editor > .ProseMirror-gapcursor + p {
  padding-top: 0 !important;
}

/*
 * A gap cursor at the end of the document does displace this one -- but every
 * block above already has \`margin-bottom: 0\`, so there is no margin to reveal
 * and nothing moves. Left as a plain \`:last-child\` on purpose.
 */
.ny-editor-root .milkdown .editor > *:last-child {
  margin-bottom: 0 !important;
}

.ny-editor-root .milkdown .editor blockquote > *:first-child,
.ny-editor-root .milkdown .editor blockquote > .ProseMirror-gapcursor + * {
  margin-top: 0 !important;
}

/* paragraph gap, inside a quote. */
.ny-editor-root .milkdown .editor blockquote > p:first-child,
.ny-editor-root .milkdown .editor blockquote > .ProseMirror-gapcursor + p {
  padding-top: 0 !important;
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
  /* paragraph gap: a list row owns its spacing, the paragraph inside owns none. */
  padding: 0 !important;
}

.ny-editor-root .milkdown .editor .content-dom > p + p {
  padding-top: 0.45em !important;
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
  border-radius: 12px !important;
  overflow: visible !important;
  position: relative !important;
  background: var(--ny-editor-codeblock-bg) !important;
  box-shadow: none !important;
}

/*
 * Code-block tools live INSIDE the block's own box, pinned to its top-right
 * corner as an overlay. Two things fall out of that, both deliberate:
 *
 * 1. The pill takes no layout height, so a one-line code block stays one line
 *    tall instead of paying for a full toolbar row.
 * 2. It can never overlap anything outside the block. Floating it above the
 *    block (the obvious way to reclaim the height) means every hover on the
 *    way to the paragraph above covers the text you were aiming for.
 *
 * Sizing is load-bearing: a single code line is ~17.5px (13px / 1.35), so the
 * pill is kept at 24px and \`.codemirror-host\` carries a min-height that
 * guarantees it fits. Grow either one without the other and the pill pokes out
 * the bottom of a one-line block, which re-creates the exact bug above.
 */
.ny-editor-root .milkdown .milkdown-code-block .tools {
  position: absolute !important;
  top: 4px !important;
  right: 5px !important;
  bottom: auto !important;
  left: auto !important;
  z-index: 10 !important;
  display: flex !important;
  align-items: center !important;
  gap: 2px !important;
  width: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 2px !important;
  overflow: visible !important;
  border: 1px solid var(--ny-editor-codetools-border) !important;
  border-radius: 999px !important;
  background: var(--ny-editor-codetools-bg) !important;
  backdrop-filter: blur(14px) saturate(1.6) !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.6) !important;
  box-shadow: var(--ny-editor-codetools-shadow) !important;
  opacity: 0 !important;
  transform: translateY(-3px) scale(0.94) !important;
  transform-origin: 100% 0 !important;
  pointer-events: none !important;
  transition:
    opacity 0.16s ease,
    transform 0.18s cubic-bezier(0.32, 0.72, 0, 1) !important;
}

/*
 * \`:has(...)\` keeps the pill alive while the language list is open -- the list
 * renders outside the pill's box, so the pointer leaves \`:hover\` the moment you
 * reach for an entry.
 */
.ny-editor-root .milkdown .milkdown-code-block:hover .tools,
.ny-editor-root .milkdown .milkdown-code-block:focus-within .tools,
.ny-editor-root
  .milkdown
  .milkdown-code-block:has(.language-button[data-expanded="true"])
  .tools {
  opacity: 1 !important;
  transform: none !important;
  pointer-events: auto !important;
}

/*
 * The open language list hangs over whatever blocks follow, and every pill
 * shares the same z-index, so the NEXT block's pill wins on DOM order and
 * covers the list. Two halves to one fix: lift the pill that owns the open
 * list above its neighbours...
 */
.ny-editor-root
  .milkdown
  .milkdown-code-block:has(.language-button[data-expanded="true"])
  .tools {
  z-index: 60 !important;
}

/*
 * ...and silence the others outright. Pointing at an entry in the list puts the
 * cursor physically inside the block underneath, which counts as a hover and
 * pops that block's pill on top of the list you are reading.
 */
.ny-editor-root
  .milkdown
  .editor:has(.language-button[data-expanded="true"])
  .milkdown-code-block:not(:has(.language-button[data-expanded="true"]))
  .tools {
  opacity: 0 !important;
  pointer-events: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .ny-editor-root .milkdown .milkdown-code-block .tools {
    transform: none !important;
    transition: opacity 0.1s ease !important;
  }
}

/*
 * Items inside the pill are flat -- the pill itself is the surface, so nested
 * borders and backgrounds would read as chips-inside-a-chip at 18px.
 * Crepe fades these in on block hover; the pill owns that now, so pin them
 * opaque and let the parent do the transition.
 */
.ny-editor-root .milkdown .milkdown-code-block .tools .language-button {
  height: 18px !important;
  min-height: 18px !important;
  margin: 0 !important;
  padding: 0 2px 0 8px !important;
  gap: 0 !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: transparent !important;
  color: var(--ny-editor-chip-text) !important;
  opacity: 1 !important;
  cursor: default !important;
  font-size: 11px !important;
  line-height: 1 !important;
  font-weight: 500 !important;
  letter-spacing: 0.01em !important;
  white-space: nowrap !important;
  box-shadow: none !important;
  transition: background 0.14s, color 0.14s !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .language-button:hover {
  background: var(--ny-editor-codetools-hover) !important;
  color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .language-button .expand-icon {
  width: 14px !important;
  height: 14px !important;
}

.ny-editor-root
  .milkdown
  .milkdown-code-block
  .tools
  .language-button
  .expand-icon
  svg {
  width: 12px !important;
  height: 12px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group {
  gap: 2px !important;
  align-items: center !important;
}

/*
 * \`font-size: 0\` drops the "Copy" / "Hide" / "Edit" labels while keeping the
 * icons -- at this size the labels are what push the pill wide enough to cover
 * real code on the first line.
 */
.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group button {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 18px !important;
  height: 18px !important;
  min-height: 18px !important;
  padding: 0 !important;
  gap: 0 !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: transparent !important;
  color: var(--ny-editor-button-text) !important;
  opacity: 1 !important;
  cursor: default !important;
  font-size: 0 !important;
  line-height: 0 !important;
  box-shadow: none !important;
  transition: background 0.14s, color 0.14s !important;
}

.ny-editor-root
  .milkdown
  .milkdown-code-block
  .tools
  .tools-button-group
  button
  svg {
  width: 13px !important;
  height: 13px !important;
  fill: currentColor !important;
}

.ny-editor-root .milkdown .milkdown-code-block .tools .tools-button-group button:hover {
  background: var(--ny-editor-codetools-hover) !important;
  color: var(--ny-editor-text-primary) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .codemirror-host {
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 12px !important;
  /*
   * Floor tall enough for the 24px tool pill at top: 4px. A single code line
   * plus the cm-content padding already clears this; the floor only matters
   * for an empty block.
   */
  min-height: 30px !important;
  overflow: hidden !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Mermaid & friends: the preview panel takes over the bottom of the block. */
.ny-editor-root .milkdown .milkdown-code-block:has(.preview-panel) .codemirror-host {
  border-radius: 12px 12px 0 0 !important;
}

/* Preview-only mode hides the editor, so the panel becomes the whole block. */
.ny-editor-root
  .milkdown
  .milkdown-code-block:has(.codemirror-host.hidden)
  .preview-panel {
  border-top: 0 !important;
  border-radius: 12px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-editor {
  margin: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
  font-size: 13px !important;
  /*
   * 1.45 rather than CodeMirror's tighter default: it is the same line-height
   * source mode uses, and at 1.35 the code ran visibly denser than the 1.52
   * body text right above it, which is half of why the block read as a foreign
   * pane. A line is now 13 * 1.45 = 18.85px, still inside the 30px floor
   * \`.codemirror-host\` needs for the 24px tool pill.
   */
  line-height: 1.45 !important;
}

/*
 * Flat gutter. A background of its own plus a divider turned the block into a
 * two-pane IDE widget; the line numbers only ever needed to be quieter than the
 * code, not fenced off from it.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-gutters {
  background: transparent !important;
  color: var(--ny-editor-gutter-text) !important;
  border-right: 0 !important;
  font-size: 12px !important;
}

/* Nobody folds a five-line note block, and the arrow column costs real width. */
.ny-editor-root .milkdown .milkdown-code-block .cm-foldGutter {
  display: none !important;
}

/*
 * Symmetric padding instead of a min-height on the editor: it centres a
 * one-line block's text in the taller box the tool pill needs, and multi-line
 * blocks just gain matching top/bottom breathing room.
 *
 * Do NOT mirror this onto .cm-gutters. CodeMirror already offsets the first
 * gutter element by the content's padding-top, so a matching padding there
 * applies the same shift twice and drops every line number below its line.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-content {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
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
 * Only highlight the active line while the block is actually being edited.
 * CodeMirror marks line 1 active even when nothing is focused, so every code
 * block in the document carried a stray band across its first line -- and since
 * the highlight covers the line box but not .cm-content's padding, it left an
 * uncoloured strip along the top edge that read as broken spacing.
 */
.ny-editor-root
  .milkdown
  .milkdown-code-block
  .cm-editor:not(.cm-focused)
  :is(.cm-activeLine, .cm-activeLineGutter) {
  background: transparent !important;
}

/*
 * Ensure the line-number gutter is always laid out by basicSetup. Some upstream
 * resets/global :has() rules can collapse it; pin a min-width so the column
 * stays visible even when CodeMirror temporarily has nothing rendered yet.
 * 32px is the natural width of one number (1.5em at 12px plus the 14px of
 * .cm-gutterElement padding below), not a fold-arrow allowance.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-gutters {
  min-width: 32px;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-gutterElement {
  padding: 0 8px 0 6px !important;
  min-width: 1.5em;
}

/*
 * Selection, caret and the rest of CodeMirror's IDE furniture.
 *
 * \`drawSelection()\` (bundled in basicSetup, which Crepe hard-codes) does two
 * things that matter here: it paints the selection as \`.cm-selectionBackground\`
 * divs in its own colours -- #d7d4f0 light, #233 dark, matching nothing in this
 * app -- and it force-hides the NATIVE selection inside \`.cm-line\` at
 * \`Prec.highest\`. So selecting inside the block gave a lilac band that looked
 * nothing like the accent-tinted selection one line above it, and dragging a
 * selection ACROSS the block from the surrounding prose left the code
 * apparently untouched, because the only selection ProseMirror can paint there
 * is the native one CodeMirror suppresses.
 *
 * Both are fixed against the same accent as the app-wide \`::selection\`.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-selectionBackground,
.ny-editor-root
  .milkdown
  .milkdown-code-block
  .cm-focused
  > .cm-scroller
  > .cm-selectionLayer
  .cm-selectionBackground {
  background: color-mix(in srgb, var(--ny-accent), transparent 72%) !important;
}

/*
 * Restore the native selection, but only while CodeMirror is NOT focused --
 * that is exactly the cross-block case. With focus, \`drawSelection\` is painting
 * and letting the native one through would double up.
 */
.ny-editor-root
  .milkdown
  .milkdown-code-block
  .cm-editor:not(.cm-focused)
  .cm-line ::selection,
.ny-editor-root
  .milkdown
  .milkdown-code-block
  .cm-editor:not(.cm-focused)
  .cm-line::selection {
  background-color: color-mix(in srgb, var(--ny-accent), transparent 72%) !important;
}

/*
 * The visible caret is a drawn \`border-left\`, not a real one -- \`caret-color\`
 * on .cm-content is overridden to transparent by drawSelection and does
 * nothing.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-cursor,
.ny-editor-root .milkdown .milkdown-code-block .cm-dropCursor {
  border-left-color: var(--ny-editor-text-primary) !important;
}

/*
 * basicSetup also brings \`highlightSelectionMatches\` and \`bracketMatching\`.
 * Both are calibrated for an IDE: matching brackets get a teal wash, a
 * mismatched one flashes red, and every other copy of the selected word lights
 * up. In a note that is noise on top of noise, so they are reduced to a hint
 * that shares the block's own palette.
 */
.ny-editor-root .milkdown .milkdown-code-block .cm-selectionMatch {
  background: color-mix(in srgb, var(--ny-accent), transparent 88%) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .cm-matchingBracket,
.ny-editor-root .milkdown .milkdown-code-block .cm-nonmatchingBracket {
  background: transparent !important;
  color: inherit !important;
  outline: 1px solid color-mix(in srgb, var(--ny-accent), transparent 62%) !important;
  outline-offset: -1px !important;
}

.ny-editor-root .milkdown .milkdown-code-block .preview-panel {
  padding: 0 !important;
  /* Same hairline as the block's own edge, not the heavier panel divider. */
  border-top: 1px solid var(--ny-editor-codeblock-border) !important;
  background: transparent !important;
  border-radius: 0 0 12px 12px !important;
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

/* Anchored to the pill, which now sits at the block's right edge. */
.ny-editor-root .milkdown .milkdown-code-block .language-picker {
  position: absolute !important;
  top: calc(100% + 4px) !important;
  right: 0 !important;
  left: auto !important;
  width: max-content !important;
  padding-top: 0 !important;
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
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 3px 12px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  line-height: 16px !important;
}

/*
 * Language badge. The rows are otherwise a wall of same-weight 12px text, and
 * colour is the fastest channel to scan by -- the monogram is what carries the
 * long tail where there is no brand colour to recognise. It has to be a
 * pseudo-element: Crepe's \`renderLanguage\` hook returns a string that Vue
 * renders as an escaped text node, so markup injected there shows up literally.
 * See language-badges.ts for the colour table and the rules it emits below.
 */
.ny-editor-root .milkdown .milkdown-code-block .language-list-item::before {
  content: var(--ny-lang-label, '{}');
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: var(--ny-lang-bg, #8b93a3);
  color: var(--ny-lang-fg, #ffffff);
  font-family: var(--ny-font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.09);
}

/*
 * Dark mode inverts which badges need help: the near-black brand colours
 * (LESS, Lua, Crystal) lose their edge against the panel, so outline them from
 * the light side instead.
 */
:root[data-theme='dark']
  .ny-editor-root
  .milkdown
  .milkdown-code-block
  .language-list-item::before {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

/* The empty-search row carries no language, so it must not get a badge. */
.ny-editor-root .milkdown .milkdown-code-block .language-list-item.no-result::before {
  content: none;
}

/* The block's current language had no marking at all before. */
.ny-editor-root
  .milkdown
  .milkdown-code-block
  .language-list-item[aria-selected='true'] {
  color: var(--nyamark-accent) !important;
  background: color-mix(in srgb, var(--nyamark-accent), transparent 90%) !important;
}

.ny-editor-root .milkdown .milkdown-code-block .language-list-item .leading,
.ny-editor-root .milkdown .milkdown-code-block .language-list-item .leading svg {
  width: 16px !important;
  height: 16px !important;
}

${languageBadgeCss}

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

/*
 * Selecting a whole block (a code block, an image, a table) draws
 * \`.ProseMirror-selectednode\`, which upstream styles as \`outline: 2px solid
 * #8cf\` -- a hard-coded sky blue that belongs to no theme here and, being an
 * outline, ignores the block's border-radius on the corners. Same idea,
 * app palette, and it follows the rounding.
 */
.ny-editor-root .milkdown .ProseMirror .ProseMirror-selectednode {
  outline: none !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ny-accent), transparent 55%) !important;
}

/*
 * CodeMirror's tooltips (the completion popup, mostly) ship an unstyled grey
 * panel with emoji glyphs for the completion kinds. Autocompletion no longer
 * fires while typing -- see config.ts -- but the popup can still be opened on
 * demand, so give it the same surface as every other floating panel.
 *
 * Deliberately NOT scoped under \`.ny-editor-root .milkdown\`: the code block
 * clips its own content for the rounded corners, so the popup is rendered into
 * \`document.body\` instead (\`tooltips({ parent })\` in config.ts) and any
 * editor-scoped selector would miss it -- as would the \`--ny-editor-*\`
 * variables, which are declared on \`.milkdown\`. Everything below therefore
 * uses the \`:root\` tokens. The unscoped selectors also pick up source mode's
 * CodeMirror, which shares the same defaults.
 */
.cm-tooltip {
  border: 1px solid var(--ny-border-strong) !important;
  border-radius: 10px !important;
  background: var(--ny-surface-elevated) !important;
  box-shadow: var(--ny-shadow-float) !important;
  color: var(--ny-text-primary) !important;
  font-family: var(--ny-font-sans) !important;
  overflow: hidden !important;
}

.cm-tooltip.cm-tooltip-autocomplete > ul {
  font-family: var(--ny-font-mono) !important;
  font-size: 12px !important;
  max-height: 180px !important;
}

.cm-tooltip.cm-tooltip-autocomplete > ul > li {
  padding: 3px 10px !important;
  line-height: 18px !important;
  color: var(--ny-text-primary) !important;
}

.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] {
  color: var(--ny-accent) !important;
  background: color-mix(in srgb, var(--ny-accent), transparent 78%) !important;
}

/* The kind glyphs are emoji injected through \`content\`; drop the column. */
.cm-completionIcon {
  display: none !important;
}

.cm-completionLabel {
  color: inherit !important;
}

.cm-completionMatchedText {
  color: var(--ny-accent) !important;
  text-decoration: none !important;
  font-weight: 700 !important;
}

.cm-completionDetail {
  color: var(--ny-text-muted) !important;
  font-style: normal !important;
  margin-left: 8px !important;
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

/*
 * Drag-selection guard -- see \`plugins/drag-guard.ts\`.
 *
 * While \`data-ny-drag-select\` is up on <html>, every hover-triggered overlay
 * steps aside. They used to materialise under a pointer that was only passing
 * through, and an overlay that takes \`pointer-events\` mid-gesture becomes the
 * drag target, which is what cut the selection short.
 *
 * \`transition: none\` is load-bearing: fading out over 160ms would leave the
 * overlay live under the cursor for exactly the window we are closing. The
 * pill's resting \`transform\` is repeated so it does not slide back in from a
 * half-way position when the drag ends.
 */
:root[data-ny-drag-select]
  .ny-editor-root
  .milkdown
  .milkdown-code-block:not(:has(.language-button[data-expanded="true"]))
  .tools {
  opacity: 0 !important;
  transform: translateY(-3px) scale(0.94) !important;
  pointer-events: none !important;
  transition: none !important;
}

:root[data-ny-drag-select] .milkdown-block-handle,
:root[data-ny-drag-select] .milkdown-toolbar,
:root[data-ny-drag-select] .ny-editor-root .milkdown .milkdown-table-block .button-group,
:root[data-ny-drag-select] .ny-editor-root .milkdown .milkdown-table-block .cell-handle,
:root[data-ny-drag-select] .ny-editor-root .milkdown .milkdown-table-block .line-handle {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: none !important;
}

/*
 * The root cause of the interrupted drag.
 *
 * A code block is a second editing host nested inside ProseMirror's: the
 * moment a drag wanders into CodeMirror's DOM, WebKit hands CodeMirror the
 * caret, and the outer selection is gone -- you end up with a bare cursor
 * blinking on a code line and nothing selected.
 *
 * So for the duration of the drag the whole block is made unselectable. That
 * is \`user-select\`, deliberately not \`pointer-events\`: killing pointer events
 * puts the pointer on the wrapper, and WebKit resolves a point on a
 * \`contenteditable=false\` box to *before* or *after* it depending on which
 * half you are over -- so a few px of movement inside the block flips the
 * endpoint back and forth on every mousemove, which is the shaking. With
 * \`user-select: none\` WebKit skips the subtree entirely when extending a
 * selection: the endpoint walks from the paragraph above straight to the one
 * below, no hit test inside, no flip.
 *
 * The model selection still spans the node, so copy and delete are unchanged;
 * the block reads as selected because \`.ny-block-selected\` paints it.
 *
 * Scoped to "prose": a drag that STARTED inside a code block is CodeMirror's
 * own selection gesture and must stay fully selectable.
 */
:root[data-ny-drag-select="prose"] .ny-editor-root .milkdown .ProseMirror .milkdown-code-block,
:root[data-ny-drag-select="prose"] .ny-editor-root .milkdown .ProseMirror .ny-html-block {
  -webkit-user-select: none !important;
  user-select: none !important;
}

/* Already-open floating layers stay visible, but must not swallow the drag. */
:root[data-ny-drag-select] .milkdown-slash-menu,
:root[data-ny-drag-select] .milkdown-link-preview,
:root[data-ny-drag-select] .milkdown-link-edit,
:root[data-ny-drag-select] .cm-tooltip {
  pointer-events: none !important;
}

/*
 * Blocks fully inside the selection -- see \`plugins/block-selection.ts\`.
 *
 * A node view paints its own surface, so a selection running across it left a
 * lighter hole in the middle of the band. One flat wash in the same accent as
 * \`::selection\` closes it. It rides on \`::after\` so the card keeps its own
 * background, border and radius underneath, and sits below the tool pill
 * (z-index 10) so nothing that is still interactive gets tinted.
 */
.ny-editor-root .milkdown .ProseMirror .milkdown-code-block.ny-block-selected::after,
.ny-editor-root .milkdown .ProseMirror .milkdown-table-block.ny-block-selected::after,
.ny-editor-root .milkdown .ProseMirror .milkdown-image-block.ny-block-selected::after,
.ny-editor-root .milkdown .ProseMirror .ny-html-block.ny-block-selected::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--ny-accent), transparent 72%);
  pointer-events: none;
  z-index: 4;
}

.ny-editor-root .milkdown .ProseMirror .milkdown-table-block.ny-block-selected,
.ny-editor-root .milkdown .ProseMirror .milkdown-image-block.ny-block-selected,
.ny-editor-root .milkdown .ProseMirror .ny-html-block.ny-block-selected {
  position: relative !important;
}

/*
 * With the whole card washed, the native selection still showing through the
 * code lines would tint those rows twice and bring the hole back inverted.
 */
.ny-editor-root .milkdown .milkdown-code-block.ny-block-selected .cm-line ::selection,
.ny-editor-root .milkdown .milkdown-code-block.ny-block-selected .cm-line::selection {
  background-color: transparent !important;
}
`;

export function registerCrepeOverrideStyles() {
  ensureStyle('editor-crepe-overrides', css);
}
