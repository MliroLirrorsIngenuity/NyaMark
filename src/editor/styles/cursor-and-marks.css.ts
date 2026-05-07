import { ensureStyle } from '../../style/register';

// Crepe ships with a near-invisible virtual-cursor color
// (`--prosemirror-virtual-cursor-color: var(--crepe-color-outline)`) and
// lets the platform pick a low-contrast caret color too. We only override
// what the framework already exposes — `caret-color` (web standard) and the
// Crepe CSS variable — so that both follow our editor text color in light/
// dark mode without hand-writing selectors against ProseMirror internals.
const css = `
.ny-editor-root .milkdown .ProseMirror-focused {
  --prosemirror-virtual-cursor-color: var(--ny-editor-text-primary);
}
`;

export function registerCursorAndMarksStyles() {
  ensureStyle('editor-cursor-and-marks', css);
}
