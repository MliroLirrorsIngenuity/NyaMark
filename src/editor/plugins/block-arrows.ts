/**
 * Arrow keys carry the caret over an image or a rule, and into and out of a
 * code block, the way they carry it from one line of text to the next.
 *
 * ProseMirror stops on an image or a rule as a selected node: one press more
 * to get past it, no caret while it lasts, and the next letter typed replaced
 * the image. Under a table it stopped once more on the gap between the two.
 * Leaving a code block put the caret at an end of the line it reached, and
 * WebKit took it into a code block at the start of a line, wherever it had
 * been.
 *
 * The moves come from several places -- ProseMirror itself, the table and code
 * block keymaps, the gap cursor -- and each dispatches its selection while the
 * key is still being handled. A key held here for the length of that handling
 * lets the plugin take the selection they settle on and move it on to the next
 * text past the image or rule. A move up or down into or out of code lands
 * under the caret's old position. With no text past an image, as when one
 * opens the document, the selection stays where they put it.
 *
 * Code sits behind its line numbers, further right than the text around it.
 * Positions in code are measured from the start of its line and set against
 * the left edge of the block, where the text around it starts, so the start
 * of a line of code leads to the start of a paragraph and back.
 */

import { EditorView as CodeMirror } from '@codemirror/view';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

type Arrow = {
  dir: 1 | -1;
  vertical: boolean;
  /** The caret's horizontal position before the move. */
  x: number | null;
  /** Where the textblock the key was pressed in starts. */
  origin: number;
};

const ARROWS: Record<string, [1 | -1, boolean]> = {
  ArrowUp: [-1, true],
  ArrowDown: [1, true],
  ArrowLeft: [-1, false],
  ArrowRight: [1, false],
};

const isCode = (selection: Selection) =>
  !!selection.$head.parent.type.spec.code;

/** The code block's CodeMirror, when it is on screen to be measured. */
function codeMirrorAt(view: EditorView, pos: number) {
  const block = view.nodeDOM(pos);
  if (!(block instanceof HTMLElement)) return null;
  const dom = block.querySelector('.cm-editor');
  if (!(dom instanceof HTMLElement) || !dom.offsetParent) return null;
  const cm = CodeMirror.findFromDOM(dom);
  return cm && { cm, left: block.getBoundingClientRect().left };
}

function caretX(view: EditorView): number | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  if (!isCode(selection)) return view.coordsAtPos(selection.head).left;
  const code = codeMirrorAt(view, selection.$head.before());
  if (!code) return null;
  const { state } = code.cm;
  const head = state.selection.main.head;
  const caret = code.cm.coordsAtPos(head);
  const start = code.cm.coordsAtPos(state.doc.lineAt(head).from);
  return caret && start ? code.left + caret.left - start.left : null;
}

/** An image or a rule as a selected node, or a gap cursor next to one. */
function stopsOnAtom(state: EditorState, dir: 1 | -1): boolean {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    return selection.node.isBlock && selection.node.isAtom;
  }
  if (selection instanceof GapCursor) {
    const { $head } = selection;
    const next = dir > 0 ? $head.nodeAfter : $head.nodeBefore;
    return !!next?.isBlock && next.isAtom;
  }
  return false;
}

/**
 * The caret under `x` on the line of `target`'s textblock that faces the way
 * the caret came in: its first line going down, its last going up.
 */
function underX(
  view: EditorView,
  target: Selection,
  x: number,
  dir: 1 | -1
): Selection | null {
  const { $head } = target;
  const start = $head.start();
  const end = $head.end();

  if (isCode(target)) {
    const code = codeMirrorAt(view, $head.before());
    if (!code) return null;
    const { cm } = code;
    const line = cm.state.doc.line(dir > 0 ? 1 : cm.state.doc.lines);
    const box = cm.coordsAtPos(line.from);
    if (!box) return null;
    const offset = cm.posAtCoords({
      x: box.left + x - code.left,
      y: (box.top + box.bottom) / 2,
    });
    if (offset == null || offset < line.from || offset > line.to) return null;
    return TextSelection.create(view.state.doc, start + offset);
  }

  // The line's own box: a paragraph's padding holds the gap above it.
  const edge = view.coordsAtPos(dir > 0 ? start : end);
  const hit = view.posAtCoords({ left: x, top: (edge.top + edge.bottom) / 2 });
  if (!hit || hit.pos < start || hit.pos > end) return null;
  return TextSelection.create(view.state.doc, hit.pos);
}

export const blockArrows = $prose(() => {
  let pending: Arrow | null = null;
  let editor: EditorView | null = null;

  return new Plugin({
    key: new PluginKey('nyamark/block-arrows'),
    props: {
      // WebKit's own move into code, which lands at the start of a line.
      handleKeyDown(view, event) {
        const arrow = pending;
        if (!arrow?.vertical) return false;
        const { selection } = view.state;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return false;
        }
        if (
          isCode(selection) ||
          !view.endOfTextblock(event.key === 'ArrowUp' ? 'up' : 'down')
        ) {
          return false;
        }
        const { $head } = selection;
        const $side = view.state.doc.resolve(
          arrow.dir > 0 ? $head.after() : $head.before()
        );
        const next = Selection.findFrom($side, arrow.dir, true);
        if (!next || !isCode(next)) return false;
        view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
        return true;
      },
    },
    appendTransaction(trs, old, state) {
      const arrow = pending;
      if (!arrow || !editor) return null;
      if (
        !trs.some((tr) => tr.selectionSet) ||
        trs.some((tr) => tr.docChanged)
      ) {
        return null;
      }
      // One move per key; the selection set below comes back through here.
      pending = null;

      let target: Selection = state.selection;
      if (stopsOnAtom(state, arrow.dir)) {
        const from = arrow.dir > 0 ? target.$to : target.$from;
        const past = Selection.findFrom(from, arrow.dir, true);
        if (!past) return null;
        target = past;
      } else if (
        !arrow.vertical ||
        !(target instanceof TextSelection) ||
        target.$head.start() === arrow.origin ||
        (!isCode(target) && !isCode(old.selection))
      ) {
        return null;
      }
      const placed =
        arrow.vertical && arrow.x != null
          ? underX(editor, target, arrow.x, arrow.dir)
          : null;
      if (!placed && target === state.selection) return null;
      return state.tr.setSelection(placed ?? target).scrollIntoView();
    },
    view(view) {
      editor = view;
      // Capture: ahead of CodeMirror in a code block and of every handler
      // ProseMirror runs.
      const onKeyDown = (event: KeyboardEvent) => {
        pending = null;
        const arrow = ARROWS[event.key];
        if (!arrow || event.isComposing || view.composing) return;
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
          return;
        }
        pending = {
          dir: arrow[0],
          vertical: arrow[1],
          x: arrow[1] ? caretX(view) : null,
          origin: view.state.selection.$head.start(),
        };
        // The moves this key makes are dispatched while it is handled.
        setTimeout(() => {
          pending = null;
        });
      };
      const done = () => {
        pending = null;
      };
      view.dom.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keydown', done);
      return {
        destroy: () => {
          view.dom.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('keydown', done);
          editor = null;
        },
      };
    },
  });
});
