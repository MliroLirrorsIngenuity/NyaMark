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
 *
 * A document that opens with code, a table, an image or a rule had no place
 * above it for the caret: up from its top went nowhere, and there was no way
 * to start a line in front of it. There the caret becomes a gap cursor above
 * the block; typing or Enter there starts a paragraph.
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

/** The gap above the document's first block, when it holds no line of text. */
function gapAtTop(state: EditorState): GapCursor | null {
  const first = state.doc.firstChild;
  if (!first) return null;
  const { spec } = first.type;
  return spec.code || spec.isolating || (first.isBlock && first.isAtom)
    ? new GapCursor(state.doc.resolve(0))
    : null;
}

/**
 * A key that types, pressed at a gap cursor: the line it goes on is made
 * before the browser takes the key. An IME composes into the line that holds
 * the caret when it starts, and at a gap there was none -- the text was lost.
 */
function lineAtGap(view: EditorView, event: KeyboardEvent): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof GapCursor)) return false;
  if (event.metaKey || event.ctrlKey) return false;
  const types =
    event.key.length === 1 || event.key === 'Process' || event.keyCode === 229;
  if (!types) return false;
  const { $head } = selection;
  const line = $head.parent.contentMatchAt($head.index()).defaultType;
  if (!line?.isTextblock) return false;
  const tr = state.tr.insert($head.pos, line.create());
  tr.setSelection(TextSelection.create(tr.doc, $head.pos + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Up or left from the top of a code block that opens the document. */
function leavesCodeAtTop(view: EditorView, key: string): boolean {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  if (!isCode(selection) || selection.$head.before(1) !== 0) return false;
  const code = codeMirrorAt(view, 0);
  if (!code) return false;
  const { main } = code.cm.state.selection;
  if (!main.empty) return false;
  return key === 'ArrowUp'
    ? code.cm.state.doc.lineAt(main.head).number === 1
    : main.head === 0;
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
      handleDOMEvents: {
        // Text that comes with no key, as from dictation or the character
        // viewer, lands at the gap the same way.
        beforeinput(view, event) {
          const { state } = view;
          if (!(state.selection instanceof GapCursor)) return false;
          if (event.inputType !== 'insertText' || !event.data) return false;
          event.preventDefault();
          view.dispatch(state.tr.insertText(event.data).scrollIntoView());
          return true;
        },
      },
      // WebKit's own move into code, which lands at the start of a line.
      handleKeyDown(view, event) {
        // Nothing above the gap at the top. Unhandled, the key moved the
        // browser's hidden selection into the block below, and the caret
        // followed it there a moment later.
        if (
          pending &&
          pending.dir < 0 &&
          view.state.selection instanceof GapCursor &&
          view.state.selection.head === 0
        ) {
          return true;
        }
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
        if (!past) {
          const gap = arrow.dir < 0 && gapAtTop(state);
          return gap ? state.tr.setSelection(gap) : null;
        }
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
        if (lineAtGap(view, event)) return;
        const arrow = ARROWS[event.key];
        if (!arrow || event.isComposing || view.composing) return;
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
          return;
        }
        // Ahead of the code block's own keys, which keep the caret in it.
        if (arrow[0] < 0 && leavesCodeAtTop(view, event.key)) {
          const gap = gapAtTop(view.state);
          if (gap) {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(view.state.tr.setSelection(gap).scrollIntoView());
            view.focus();
            return;
          }
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
