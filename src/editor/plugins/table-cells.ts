/**
 * Makes the caret in a table cell behave like the caret in a paragraph.
 *
 * Click: Crepe's table view answers the first mousedown in a cell by selecting
 * the cell's whole paragraph, one animation frame later. Typing then replaced
 * the cell: clicking after "苹果" and typing "x" left just "x". A fast typist
 * beat the frame instead, and the late selection, built on the state from
 * before the keystroke, threw "Applying a mismatched transaction". The click
 * has already put the caret where it landed by then, so the late selection is
 * dropped. No other path selects a cell's paragraph as a node: the table's own
 * handles select whole rows and columns as cells.
 *
 * ArrowUp/ArrowDown: prosemirror-tables moves to the cell above or below and
 * puts the caret at its start, so ArrowUp from the end of "香蕉" landed in front
 * of "苹果". It moves from a collapsed caret only, and WebKit's own move from
 * selected text jumped to the first column of the next row. The caret now keeps
 * its horizontal position, the way it does between lines of text, and selected
 * text collapses towards the arrow first.
 */

import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { cellAround, nextCell } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const CELL_TYPES = new Set(['table_cell', 'table_header']);

/** `filterTransaction`: drops a selection of a cell's paragraph as a node. */
export function keepsCellCaret(tr: Transaction): boolean {
  const { selection } = tr;
  if (!tr.selectionSet || tr.docChanged) return true;
  if (!(selection instanceof NodeSelection)) return true;
  return !CELL_TYPES.has(selection.$from.parent.type.name);
}

/** The caret position in `cellPos`'s first (down) or last (up) line under `x`. */
function caretInCell(
  view: EditorView,
  cellPos: number,
  x: number,
  dir: 1 | -1
): Selection | null {
  const cell = view.nodeDOM(cellPos);
  if (!(cell instanceof HTMLElement)) return null;
  const box = (cell.querySelector('p') ?? cell).getBoundingClientRect();
  const hit = view.posAtCoords({
    left: Math.min(Math.max(x, box.left + 1), box.right - 1),
    top: dir > 0 ? box.top + 2 : box.bottom - 2,
  });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  if (cellAround($pos)?.pos !== cellPos || !$pos.parent.isTextblock) {
    return null;
  }
  return TextSelection.create(view.state.doc, hit.pos);
}

function moveVertically(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const $head = dir > 0 ? selection.$to : selection.$from;
  const $cell = cellAround($head);
  if (!$cell) return false;
  const $tail = dir > 0 ? selection.$from : selection.$to;
  if (cellAround($tail)?.pos !== $cell.pos) return false;

  if (!view.endOfTextblock(dir > 0 ? 'down' : 'up')) {
    // The browser moves between the lines of a cell; from collapsed text.
    if (!selection.empty) {
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, $head.pos))
      );
    }
    return false;
  }

  const $next = nextCell($cell, 'vert', dir);
  const target = $next
    ? (caretInCell(view, $next.pos, view.coordsAtPos($head.pos).left, dir) ??
      Selection.near($next, 1))
    : Selection.near(
        state.doc.resolve(dir > 0 ? $cell.after(-1) : $cell.before(-1)),
        dir
      );
  view.dispatch(state.tr.setSelection(target).scrollIntoView());
  return !CELL_TYPES.has(selection.$from.parent.type.name);
}

export const tableCells = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/table-cells'),
      filterTransaction: keepsCellCaret,
      props: {
        // A DOM handler runs ahead of every plugin's handleKeyDown, which is
        // where prosemirror-tables answers the arrows.
        handleDOMEvents: {
          keydown: (view, event) => {
            if (event.isComposing || view.composing) return false;
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            const dir =
              event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (!dir || !moveVertically(view, dir)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    })
);
