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
 * text collapses towards the arrow first. It keeps it on the way into a table
 * and out of one too: WebKit took ArrowUp from under a table to its last
 * cell, and leaving a table put the caret at an end of the line it reached.
 *
 * Tab in the last cell: there is no next cell, and the indent plugin behind
 * the table's keymap typed four spaces into the cell. It adds a row and moves
 * into it, the way Tab grows a table in other editors.
 *
 * Enter: Milkdown leaves the table onto a new empty paragraph every time, so
 * a table already followed by one -- always the case at the end of a document
 * -- gained another, saved as a stray `<br />`. The one already there is used.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { addRowWithAlignment } from '@milkdown/kit/preset/gfm';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { cellAround, nextCell, selectedRect } from '@milkdown/kit/prose/tables';
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

/** The caret under `x` on the first or last line of the textblock at `pos`. */
function caretInTextblock(
  view: EditorView,
  pos: number,
  x: number,
  line: 'first' | 'last'
): Selection | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node?.isTextblock) return null;
  // The line's own box: a paragraph's padding holds the gap above it.
  const end = view.coordsAtPos(
    line === 'first' ? pos + 1 : pos + node.nodeSize - 1
  );
  const hit = view.posAtCoords({ left: x, top: (end.top + end.bottom) / 2 });
  if (!hit || hit.pos <= pos || hit.pos >= pos + node.nodeSize) return null;
  return TextSelection.create(view.state.doc, hit.pos);
}

/** ArrowUp/ArrowDown from the line next to a table into the cell under it. */
function enterTable(view: EditorView, dir: 1 | -1): boolean {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $head } = selection;
  if (!$head.parent.isTextblock || cellAround($head)) return false;
  if (!view.endOfTextblock(dir > 0 ? 'down' : 'up')) return false;
  const $edge = view.state.doc.resolve(
    dir > 0 ? $head.after() : $head.before()
  );
  const table = dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
  if (table?.type.name !== 'table') return false;

  const tablePos = dir > 0 ? $edge.pos : $edge.pos - table.nodeSize;
  const row = dir > 0 ? table.firstChild : table.lastChild;
  if (!row) return false;
  const rowPos =
    tablePos + 1 + (dir > 0 ? 0 : table.content.size - row.nodeSize);
  const x = view.coordsAtPos($head.pos).left;
  let cellPos = rowPos + 1;
  let distance = Number.POSITIVE_INFINITY;
  row.forEach((_cell, offset) => {
    const dom = view.nodeDOM(rowPos + 1 + offset);
    if (!(dom instanceof HTMLElement)) return;
    const box = dom.getBoundingClientRect();
    const away = x < box.left ? box.left - x : Math.max(0, x - box.right);
    if (away < distance) {
      distance = away;
      cellPos = rowPos + 1 + offset;
    }
  });
  const target =
    caretInCell(view, cellPos, x, dir) ??
    Selection.near(view.state.doc.resolve(cellPos + 1), 1);
  view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
  return true;
}

function moveVertically(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const $head = dir > 0 ? selection.$to : selection.$from;
  const $cell = cellAround($head);
  if (!$cell) return enterTable(view, dir);
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

  const x = view.coordsAtPos($head.pos).left;
  const $next = nextCell($cell, 'vert', dir);
  // A cell's text sits inside its padding, right of the text around the
  // table: measured from the cell's edge, the start of a cell leads to the
  // start of the line next to the table.
  const cellBox = (
    view.nodeDOM($cell.pos) as HTMLElement | null
  )?.getBoundingClientRect();
  const outX = cellBox
    ? cellBox.left + x - view.coordsAtPos($cell.pos + 2).left
    : x;
  let target: Selection | null;
  if ($next) {
    target = caretInCell(view, $next.pos, x, dir) ?? Selection.near($next, 1);
  } else {
    // Out of the table, onto the line next to it.
    const $out = state.doc.resolve(
      dir > 0 ? $cell.after(-1) : $cell.before(-1)
    );
    const block = dir > 0 ? $out.nodeAfter : $out.nodeBefore;
    target =
      (block &&
        caretInTextblock(
          view,
          dir > 0 ? $out.pos : $out.pos - block.nodeSize,
          outX,
          dir > 0 ? 'first' : 'last'
        )) ??
      // Nothing past a table that opens the document: the gap above it,
      // where typing starts a line.
      (!block && $out.depth === 0
        ? new GapCursor($out)
        : Selection.near($out, dir));
  }
  view.dispatch(state.tr.setSelection(target).scrollIntoView());
  return !CELL_TYPES.has(selection.$from.parent.type.name);
}

/** Tab from the last cell: a new row below, the caret in its first cell. */
function addRowFromLastCell(ctx: Ctx, view: EditorView): boolean {
  const { state } = view;
  if (!(state.selection instanceof TextSelection)) return false;
  const $cell = cellAround(state.selection.$head);
  if (!$cell || cellAround(state.selection.$anchor)?.pos !== $cell.pos) {
    return false;
  }
  const table = $cell.node(-1);
  const lastRow = $cell.index(-1) === table.childCount - 1;
  if (!lastRow || $cell.index() !== $cell.parent.childCount - 1) return false;
  const rect = selectedRect(state);
  const tr = addRowWithAlignment(ctx, state.tr, rect, rect.map.height);
  const rowPos = rect.tableStart + rect.table.content.size;
  tr.setSelection(Selection.near(tr.doc.resolve(rowPos + 1), 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Enter in a cell onto the empty paragraph already under the table. */
function enterParagraphBelow(view: EditorView): boolean {
  const { state } = view;
  const $cell = cellAround(state.selection.$head);
  if (!$cell) return false;
  const below = $cell.after(-1);
  const next = state.doc.resolve(below).nodeAfter;
  if (next?.type.name !== 'paragraph' || next.content.size > 0) return false;
  view.dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, below + 1))
      .scrollIntoView()
  );
  return true;
}

export const tableCells = $prose(
  (ctx) =>
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
        handleKeyDown(view, event) {
          if (event.isComposing || view.composing) return false;
          if (event.shiftKey || event.altKey || event.ctrlKey) return false;
          if (event.key === 'Tab' && !event.metaKey) {
            return addRowFromLastCell(ctx, view);
          }
          if (event.key === 'Enter') return enterParagraphBelow(view);
          return false;
        },
      },
    })
);
