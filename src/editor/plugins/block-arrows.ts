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
 * An HTML block sits alone in a paragraph, and the caret stopped there beside
 * it, a bar the height of the block; the next letter typed turned the block
 * into its source in a line of text. The caret goes past it as it goes past
 * an image. One that ends the document is selected whole.
 *
 * A document that opens with code, a table, an image or a rule had no place
 * above it for the caret: up from its top went nowhere, and there was no way
 * to start a line in front of it. There the caret becomes a gap cursor above
 * the block; typing or Enter there starts a paragraph.
 *
 * Shift and an arrow from the edge of the text next to one of these blocks
 * left the selection to the browser, which reached into the block's own view
 * where ProseMirror could not follow: the highlight showed one range and
 * Backspace deleted another -- the rest of the document past a formula, or a
 * code block turned into a paragraph. The selection now takes the block whole
 * and its head goes on to the text past it, under the caret going up or down.
 */

import { EditorSelection, Prec, findClusterBreak } from '@codemirror/state';
import { EditorView as CodeMirror, keymap } from '@codemirror/view';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import {
  isHtmlBlock,
  isHtmlBlockSelected,
  selectHtmlBlockAt,
} from './html-block';

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

/**
 * The caret in `cm`, on the row it is drawn on. Where a long line of code wraps
 * one row ends and the next starts at the same place; a caret set there with
 * no side named is drawn at the start of the next row, and CodeMirror moved it
 * up and down from the end of the row before.
 */
function drawnCaret(cm: CodeMirror) {
  const { main } = cm.state.selection;
  if (main.assoc) return main;
  const { head, bidiLevel, goalColumn } = main;
  return EditorSelection.cursor(head, 1, bidiLevel ?? undefined, goalColumn);
}

/**
 * Whether the caret in `cm` is on the block's top row, going up, or its bottom
 * row going down. A long line of code wraps onto rows of its own.
 */
function onEdgeRow(cm: CodeMirror, dir: 1 | -1): boolean {
  const end = cm.moveToLineBoundary(drawnCaret(cm), dir > 0).head;
  return dir > 0 ? end >= cm.state.doc.length : end <= 0;
}

function rowMove(dir: 1 | -1) {
  return (cm: CodeMirror) => {
    if (!cm.state.selection.main.empty || onEdgeRow(cm, dir)) return false;
    const moved = cm.moveVertically(drawnCaret(cm), dir > 0);
    cm.dispatch({
      selection: EditorSelection.create([moved]),
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
}

/**
 * Up and down in a code block go a row at a time, out of it only from its top
 * or bottom row. The block's own keys took the caret out from anywhere on its
 * first or last line, and the rows of a long line wrapped there were skipped.
 */
export const codeArrowsByRow = Prec.highest(
  keymap.of([
    { key: 'ArrowUp', run: rowMove(-1) },
    { key: 'ArrowDown', run: rowMove(1) },
  ])
);

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

/** A line at the gap cursor, the caret in it. */
function lineAtGap(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof GapCursor)) return null;
  const { $head } = selection;
  const line = $head.parent.contentMatchAt($head.index()).defaultType;
  if (!line?.isTextblock) return null;
  const tr = state.tr.insert($head.pos, line.create());
  return tr.setSelection(TextSelection.create(tr.doc, $head.pos + 1));
}

/** A line in place of the rule, image or HTML block selected, the caret in it. */
function lineOverBlock(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const { from, to, $from, node } = selection;
  if (isHtmlBlockSelected(selection)) {
    const tr = state.tr.delete(from, to);
    return tr.setSelection(TextSelection.create(tr.doc, from));
  }
  if (!node.isBlock || !node.isAtom) return null;
  const line = $from.parent.contentMatchAt($from.index()).defaultType;
  if (!line?.isTextblock) return null;
  const tr = state.tr.replaceWith(from, to, line.create());
  return tr.setSelection(TextSelection.create(tr.doc, from + 1));
}

/**
 * A key that types, pressed at a gap cursor or on a block selected whole: the
 * line it goes on is made before the browser takes the key. An IME composes
 * into the line that holds the caret when it starts: at a gap there was none
 * and the text was lost, and over a rule, an image or an HTML block it went
 * to the start of the line after or the end of the line before.
 */
function lineToType(view: EditorView, event: KeyboardEvent): boolean {
  // Keys typed into a field of the block's own, as an image's caption.
  if (event.target !== view.dom) return false;
  if (event.metaKey || event.ctrlKey) return false;
  const types =
    event.key.length === 1 || event.key === 'Process' || event.keyCode === 229;
  if (!types) return false;
  const tr = lineAtGap(view.state) ?? lineOverBlock(view.state);
  if (!tr) return false;
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
  return key === 'ArrowUp' ? onEdgeRow(code.cm, -1) : main.head === 0;
}

/** The caret beside an HTML block, in the paragraph that holds it. */
const besideHtml = (selection: Selection) =>
  selection instanceof TextSelection && isHtmlBlock(selection.$head.parent);

/**
 * The text past the HTML blocks `selection` lies beside, going `dir`; the last
 * of them selected whole when no text follows.
 */
function pastHtml(doc: Node, selection: Selection, dir: 1 | -1): Selection {
  let target = selection;
  while (besideHtml(target)) {
    const { $head } = target;
    const side = doc.resolve(dir > 0 ? $head.after() : $head.before());
    const next = Selection.findFrom(side, dir, true);
    if (!next) return selectHtmlBlockAt(doc, $head.before());
    target = next;
  }
  return target;
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
    const box = cm.coordsAtPos(line.from, 1);
    // The row the caret comes in on: a long line wraps onto several.
    const row = dir > 0 ? box : cm.coordsAtPos(line.to, -1);
    if (!box || !row) return null;
    let offset = cm.posAtCoords({
      x: box.left + x - code.left,
      y: (row.top + row.bottom) / 2,
    });
    if (offset == null || offset < line.from || offset > line.to) return null;
    // Past the end of a wrapped row, the caret would be drawn on the next.
    const drawn = offset > line.from && cm.coordsAtPos(offset, 1);
    if (drawn && drawn.top >= row.bottom - 1) {
      offset =
        line.from + findClusterBreak(line.text, offset - line.from, false);
    }
    return TextSelection.create(view.state.doc, start + offset);
  }

  // The line's own box: a paragraph's padding holds the gap above it.
  const edge = view.coordsAtPos(dir > 0 ? start : end);
  const hit = view.posAtCoords({ left: x, top: (edge.top + edge.bottom) / 2 });
  if (!hit) return null;
  if (hit.pos >= start && hit.pos <= end) {
    return TextSelection.create(view.state.doc, hit.pos);
  }
  // Into a table, the cell under the caret in the row it comes to: the move
  // that lands in the row picks its first or last cell.
  const row = tableDepth($head) + 1;
  if (row < 1) return null;
  const $hit = view.state.doc.resolve(hit.pos);
  if (!$hit.parent.isTextblock || $hit.depth <= row) return null;
  if ($hit.before(row) !== $head.before(row)) return null;
  return TextSelection.create(view.state.doc, hit.pos);
}

/** The depth of the table `$pos` is in, or -1. */
function tableDepth($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') return depth;
  }
  return -1;
}

/** Whether the caret at `$head` is on the line of its text facing `dir`. */
function atEdge(
  view: EditorView,
  $head: ResolvedPos,
  dir: 1 | -1,
  vertical: boolean
): boolean {
  const end = dir > 0 ? $head.end() : $head.start();
  if (!vertical) return $head.pos === end;
  const caret = view.coordsAtPos($head.pos);
  const edge = view.coordsAtPos(end);
  const middle = (caret.top + caret.bottom) / 2;
  return dir > 0 ? middle > edge.top : middle < edge.bottom;
}

/**
 * The text past the code, tables, images and rules that lie from `pos` in
 * `dir`, or the last text there is when they end the document. Null when no
 * such block comes first.
 */
function pastBlocks(doc: Node, pos: number, dir: 1 | -1): Selection | null {
  let from = pos;
  let crossed = false;
  for (;;) {
    const next = Selection.findFrom(doc.resolve(from), dir);
    if (!next) {
      if (!crossed) return null;
      const edge = doc.resolve(dir > 0 ? doc.content.size : 0);
      return Selection.findFrom(edge, -dir as 1 | -1, true);
    }
    if (next instanceof NodeSelection) {
      from = dir > 0 ? next.to : next.from;
    } else if (besideHtml(next)) {
      from = dir > 0 ? next.$head.after() : next.$head.before();
    } else {
      const { $head } = next;
      const depth = isCode(next) ? $head.depth : tableDepth($head);
      if (depth < 0) return crossed ? next : null;
      from = dir > 0 ? $head.after(depth) : $head.before(depth);
    }
    crossed = true;
  }
}

/** Shift and an arrow at the edge of the text, over the block next to it. */
function extendPastBlock(
  view: EditorView,
  dir: 1 | -1,
  vertical: boolean
): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $head } = selection;
  if (isCode(selection) || tableDepth($head) >= 0) return false;
  if (!atEdge(view, $head, dir, vertical)) return false;
  const past = pastBlocks(
    state.doc,
    dir > 0 ? $head.after() : $head.before(),
    dir
  );
  if (!past) return false;

  let head = past.head;
  if (vertical && !isCode(past) && tableDepth(past.$head) < 0) {
    const x = view.coordsAtPos($head.pos).left;
    head = underX(view, past, x, dir)?.head ?? head;
  }
  // Nothing past a block that ends the document: as far as the text goes.
  if (dir > 0 ? head <= $head.pos : head >= $head.pos) {
    head = dir > 0 ? $head.end() : $head.start();
  }
  const tr = state.tr.setSelection(
    TextSelection.create(state.doc, selection.anchor, head)
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const blockArrows = $prose(() => {
  let pending: Arrow | null = null;
  let editor: EditorView | null = null;
  /** A move into a block whose source shows only once the caret is in it. */
  let unmeasured: { x: number; dir: 1 | -1 } | null = null;

  return new Plugin({
    key: new PluginKey('nyamark/block-arrows'),
    props: {
      handleDOMEvents: {
        // Text that comes with no key, as from dictation or the character
        // viewer, lands at the gap or over the block the same way.
        beforeinput(view, event) {
          const { state } = view;
          if (event.inputType !== 'insertText' || !event.data) return false;
          const tr =
            state.selection instanceof GapCursor
              ? state.tr
              : lineOverBlock(state);
          if (!tr) return false;
          event.preventDefault();
          view.dispatch(tr.insertText(event.data).scrollIntoView());
          return true;
        },
        // For a moment after it takes focus, ProseMirror reads a caret at the
        // top of the document as one the browser dropped there and puts it
        // back: ArrowUp from code onto the first line, pressed again at once,
        // was lost. Focus that comes back from code inside the editor was
        // handed over with the caret already placed.
        focus(view, event) {
          const from = event.relatedTarget;
          if (!(from instanceof HTMLElement) || !view.dom.contains(from)) {
            return false;
          }
          // After ProseMirror's own handler, which notes the time.
          queueMicrotask(() => {
            const { input } = view as unknown as {
              input?: { lastFocus?: number };
            };
            if (typeof input?.lastFocus === 'number') input.lastFocus = 0;
          });
          return false;
        },
      },
      // WebKit's own moves into code, which lands at the start of a line,
      // and beside an HTML block, which leaves no transaction to take over.
      handleKeyDown(view) {
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
        if (!arrow) return false;
        const { selection } = view.state;
        // From an HTML block selected whole, on to the text past it; at the
        // end of the document it stays, where ProseMirror put the caret
        // beside it.
        if (isHtmlBlockSelected(selection)) {
          const { doc } = view.state;
          const { $from } = selection;
          const side = doc.resolve(
            arrow.dir > 0 ? $from.after() : $from.before()
          );
          const next = Selection.findFrom(side, arrow.dir, true);
          const past = next ? pastHtml(doc, next, arrow.dir) : selection;
          if (!past.eq(selection)) {
            view.dispatch(view.state.tr.setSelection(past).scrollIntoView());
          }
          return true;
        }
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return false;
        }
        const edge = arrow.vertical
          ? arrow.dir > 0
            ? 'down'
            : 'up'
          : arrow.dir > 0
            ? 'forward'
            : 'backward';
        if (isCode(selection) || !view.endOfTextblock(edge)) return false;
        const { $head } = selection;
        const $side = view.state.doc.resolve(
          arrow.dir > 0 ? $head.after() : $head.before()
        );
        const next = Selection.findFrom($side, arrow.dir, true);
        if (next && besideHtml(next)) {
          const past = pastHtml(view.state.doc, next, arrow.dir);
          const placed =
            arrow.x != null && past instanceof TextSelection && !isCode(past)
              ? underX(view, past, arrow.x, arrow.dir)
              : null;
          view.dispatch(
            view.state.tr.setSelection(placed ?? past).scrollIntoView()
          );
          return true;
        }
        if (!arrow.vertical || !next || !isCode(next)) return false;
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
        target = pastHtml(state.doc, past, arrow.dir);
      } else if (besideHtml(target)) {
        target = pastHtml(state.doc, target, arrow.dir);
      } else if (
        !arrow.vertical ||
        !(target instanceof TextSelection) ||
        target.$head.start() === arrow.origin ||
        (!isCode(target) && !isCode(old.selection))
      ) {
        return null;
      }
      const placed =
        arrow.vertical && arrow.x != null && target instanceof TextSelection
          ? underX(editor, target, arrow.x, arrow.dir)
          : null;
      if (!placed && isCode(target) && arrow.x != null) {
        unmeasured = { x: arrow.x, dir: arrow.dir };
      }
      if (!placed && target === state.selection) return null;
      return state.tr.setSelection(placed ?? target).scrollIntoView();
    },
    view(view) {
      editor = view;
      // Capture: ahead of CodeMirror in a code block and of every handler
      // ProseMirror runs.
      const onKeyDown = (event: KeyboardEvent) => {
        pending = null;
        if (lineToType(view, event)) return;
        const arrow = ARROWS[event.key];
        if (!arrow || event.isComposing || view.composing) return;
        if (event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.shiftKey) {
          if (extendPastBlock(view, arrow[0], arrow[1])) {
            // ProseMirror listens on the same element.
            event.preventDefault();
            event.stopImmediatePropagation();
          }
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
        // A math or diagram block hides its source until the caret is in it,
        // so the line under the caret is found once it shows -- a frame on,
        // when CodeMirror has taken focus and set its own caret.
        update: () => {
          const move = unmeasured;
          unmeasured = null;
          if (!move) return;
          const { doc, selection: entered } = view.state;
          requestAnimationFrame(() => {
            const { selection } = view.state;
            if (view.state.doc !== doc || !selection.eq(entered)) return;
            if (!(selection instanceof TextSelection) || !isCode(selection)) {
              return;
            }
            const code = codeMirrorAt(view, selection.$head.before());
            const placed = underX(view, selection, move.x, move.dir);
            if (!code || !placed || placed.head === selection.head) return;
            // ProseMirror leaves the caret to CodeMirror once it has focus.
            code.cm.dispatch({
              selection: { anchor: placed.head - selection.$head.start() },
              scrollIntoView: true,
            });
          });
        },
        destroy: () => {
          view.dom.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('keydown', done);
          editor = null;
        },
      };
    },
  });
});
