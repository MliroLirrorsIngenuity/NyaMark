/**
 * Keeps hover-triggered overlays out of the way of a selection drag.
 *
 * Every floating widget in Crepe -- the code-block tool pill, the block
 * handle, the table row/column handles, the selection toolbar -- appears
 * because the pointer is over (or the selection touches) its owner. During a
 * drag the pointer is merely *passing through*: the widget materialises under
 * a cursor that is in the middle of a gesture, and once it takes
 * `pointer-events` the drag is being tracked over a different element and the
 * selection stops growing. That is the "拖拽选中会被弹窗的任何组件打断"
 * report -- it never happens between plain paragraphs because paragraphs own
 * no overlays.
 *
 * The fix is a single flag on <html>; `crepe-overrides.css.ts` gates the
 * hover rules on it. Details that matter:
 *
 *   - The flag is only raised once the pointer has actually moved past a
 *     threshold, so a plain click does not make the pill blink.
 *   - A press that *starts* on an overlay is a click on that overlay (copy
 *     button, language picker, toolbar item), not a text drag -- suppressing
 *     it would eat the click, so those are skipped entirely.
 *   - Release is watched on `window`: letting go outside the editor bounds is
 *     the normal way a drag ends, and a flag stuck on would freeze every
 *     overlay in the app.
 */

/**
 * Manhattan distance, in CSS px, before a press counts as a drag. Small on
 * purpose: the guard has to be up before the pointer reaches the next block,
 * and the block gap is only ~0.72em.
 */
const DRAG_THRESHOLD_PX = 3;

/** Presses starting inside any of these are clicks on a widget, not drags. */
const OVERLAY_SELECTOR = [
  '.milkdown-code-block .tools',
  '.milkdown-block-handle',
  '.milkdown-toolbar',
  '.milkdown-slash-menu',
  '.milkdown-link-preview',
  '.milkdown-link-edit',
  '.milkdown-table-block .button-group',
  '.milkdown-table-block .cell-handle',
  '.milkdown-table-block .line-handle',
  '.ny-image-meta',
].join(',');

/**
 * Editables nested inside the document that are not ProseMirror's own: the
 * CodeMirror instance in a code block, the HTML block's textarea. Each is a
 * separate editing host, and a drag that wanders into one hands it the caret
 * and ends the outer selection -- which is the actual root cause of "拖拽选中
 * 到代码框里会被代码框给抢走光标然后中断拖拽".
 *
 * Matching here only decides *whose* gesture this is. A press that starts in
 * the prose flags "prose", and the stylesheet then makes those blocks
 * unselectable for the duration so the drag passes over them; a press that
 * starts inside one of them is that editor's own drag and is flagged "code",
 * which leaves it untouched.
 */
const NESTED_EDITOR_SELECTOR = '.cm-editor,textarea,input';

export function installDragSelectGuard(root: HTMLElement): () => void {
  const flagHost = document.documentElement;
  let origin: { x: number; y: number; inNestedEditor: boolean } | null = null;

  const raise = () => {
    // A drag that STARTED inside a nested editor is that editor's own
    // selection gesture -- it has to keep receiving the pointer. Only a drag
    // that started in the prose gets the nested editors taken out of the way.
    flagHost.dataset.nyDragSelect = origin?.inNestedEditor ? 'code' : 'prose';
  };
  const clear = () => {
    origin = null;
    delete flagHost.dataset.nyDragSelect;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(OVERLAY_SELECTOR)) return;
    origin = {
      x: event.clientX,
      y: event.clientY,
      inNestedEditor: !!target.closest(NESTED_EDITOR_SELECTOR),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!origin || flagHost.dataset.nyDragSelect) return;
    const travelled =
      Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y);
    if (travelled >= DRAG_THRESHOLD_PX) raise();
  };

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', clear);
  window.addEventListener('pointercancel', clear);
  window.addEventListener('blur', clear);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', clear);
    window.removeEventListener('pointercancel', clear);
    window.removeEventListener('blur', clear);
    clear();
  };
}
