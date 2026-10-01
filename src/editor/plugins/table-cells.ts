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
 * Enter: Milkdown left the table from any cell, the header's too, so Enter
 * while filling in a row threw the caret out under the table. It goes down a
 * row in the same column instead, and from the last row adds one, the way
 * Enter goes through a list; on a last row still empty it takes that row away
 * and leaves the table, as Enter on an empty item ends a list. Cmd+Enter
 * leaves from anywhere. Leaving onto a table already followed by an empty
 * paragraph -- always the case at the end of a document -- uses that one:
 * Milkdown added another, saved as a stray `<br />`.
 *
 * A line typed as a table's top row, `| 名称 | 数量 |`, stayed text on Enter:
 * the table's own shortcut is `|2x2|`, which nobody types. Enter at its end
 * turns it into a table with those headings and an empty row to fill in, the
 * way other Markdown editors do.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { paragraphSchema } from '@milkdown/kit/preset/commonmark';
import {
  addRowWithAlignment,
  tableCellSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableSchema,
} from '@milkdown/kit/preset/gfm';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';
import type { Fragment, Node, ResolvedPos } from '@milkdown/kit/prose/model';
import {
  type EditorState,
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

/** The cell holding the whole selection, as a position in its row. */
function selectedCell(state: EditorState): ResolvedPos | null {
  if (!(state.selection instanceof TextSelection)) return null;
  const $cell = cellAround(state.selection.$head);
  if (!$cell || cellAround(state.selection.$anchor)?.pos !== $cell.pos) {
    return null;
  }
  return $cell;
}

/** A new row under the table, the caret in its cell in column `col`. */
function addRowBelow(ctx: Ctx, view: EditorView, col: number): void {
  const rect = selectedRect(view.state);
  const tr = addRowWithAlignment(ctx, view.state.tr, rect, rect.map.height);
  let cellPos = rect.tableStart + rect.table.content.size + 1;
  const row = tr.doc.nodeAt(cellPos - 1);
  for (let i = 0; row && i < Math.min(col, row.childCount - 1); i += 1) {
    cellPos += row.child(i).nodeSize;
  }
  tr.setSelection(Selection.near(tr.doc.resolve(cellPos + 1), 1));
  view.dispatch(tr.scrollIntoView());
}

/** Tab from the last cell: a new row below, the caret in its first cell. */
function addRowFromLastCell(ctx: Ctx, view: EditorView): boolean {
  const $cell = selectedCell(view.state);
  if (!$cell) return false;
  const table = $cell.node(-1);
  const lastRow = $cell.index(-1) === table.childCount - 1;
  if (!lastRow || $cell.index() !== $cell.parent.childCount - 1) return false;
  addRowBelow(ctx, view, 0);
  return true;
}

/** A row with nothing typed in any of its cells. */
export function isEmptyRow(row: Node): boolean {
  let empty = true;
  row.descendants((node) => {
    if (node.isInline) empty = false;
    return empty;
  });
  return empty;
}

/**
 * Enter in a cell: to the end of the cell below. From the last row, a new row
 * to fill in; from a last row left empty, out of the table, the row gone.
 */
function enterCellBelow(ctx: Ctx, view: EditorView): boolean {
  const { state } = view;
  const $cell = selectedCell(state);
  if (!$cell) return false;
  const $below = nextCell($cell, 'vert', 1);
  if ($below) {
    const end = $below.pos + ($below.nodeAfter?.nodeSize ?? 2) - 1;
    view.dispatch(
      state.tr
        .setSelection(Selection.near(state.doc.resolve(end), -1))
        .scrollIntoView()
    );
    return true;
  }
  const row = $cell.parent;
  if (!isEmptyRow(row)) {
    addRowBelow(ctx, view, $cell.index());
    return true;
  }
  const tr = state.tr;
  // The header and one row are as few as a table has.
  if ($cell.node(-1).childCount > 2) tr.delete($cell.before(), $cell.after());
  const below = tr.mapping.map($cell.after(-1));
  const next = tr.doc.nodeAt(below);
  if (next?.type.name !== 'paragraph' || next.content.size > 0) {
    tr.insert(below, paragraphSchema.type(ctx).create());
  }
  tr.setSelection(TextSelection.create(tr.doc, below + 1));
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

/**
 * The cells of a line typed as a table row, `| 名称 | 数量 |`, each the text
 * between two bars with its marks; null for any other line.
 */
export function rowCells(line: Node): Fragment[] | null {
  const bars: number[] = [];
  let plain = true;
  line.forEach((child, offset) => {
    const text = child.isText ? (child.text ?? '') : null;
    if (text === null) {
      plain = false;
      return;
    }
    for (let i = text.indexOf('|'); i >= 0; i = text.indexOf('|', i + 1)) {
      bars.push(offset + i);
    }
  });
  if (!plain || bars.length < 2) return null;
  // Only text, so a character's index is its offset in the line.
  const text = line.textContent;
  const first = bars[0] ?? 0;
  const last = bars[bars.length - 1] ?? 0;
  if (text.slice(0, first).trim() || text.slice(last + 1).trim()) return null;
  const cells: Fragment[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    let from = (bars[i - 1] ?? 0) + 1;
    let to = bars[i] ?? 0;
    while (from < to && /\s/.test(text.charAt(from))) from += 1;
    while (to > from && /\s/.test(text.charAt(to - 1))) to -= 1;
    cells.push(line.content.cut(from, to));
  }
  return cells.some((cell) => cell.size > 0) ? cells : null;
}

/** Enter at the end of `| 名称 | 数量 |`: a table with those headings. */
function tableFromLine(ctx: Ctx, view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $head } = selection;
  const line = $head.parent;
  if (line.type.name !== 'paragraph') return false;
  if ($head.parentOffset !== line.content.size) return false;
  const cells = rowCells(line);
  const table = tableSchema.type(ctx);
  if (
    !cells ||
    !$head.node(-1).canReplaceWith($head.index(-1), $head.indexAfter(-1), table)
  ) {
    return false;
  }
  const paragraph = line.type;
  // No alignment, as a table read from `| --- |` has.
  const plain = { alignment: null };
  const node = table.create(null, [
    tableHeaderRowSchema.type(ctx).create(
      null,
      cells.map((content) =>
        tableHeaderSchema
          .type(ctx)
          .create(plain, paragraph.create(null, content))
      )
    ),
    tableRowSchema.type(ctx).create(
      null,
      cells.map(() =>
        tableCellSchema.type(ctx).create(plain, paragraph.create())
      )
    ),
  ]);
  const start = $head.before();
  const tr = state.tr.replaceWith(start, $head.after(), node);
  const body = start + 1 + (node.firstChild?.nodeSize ?? 0);
  tr.setSelection(Selection.near(tr.doc.resolve(body + 1), 1));
  view.dispatch(tr.scrollIntoView());
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
          if (event.key === 'Enter') {
            if (!event.metaKey && enterCellBelow(ctx, view)) return true;
            return enterParagraphBelow(view) || tableFromLine(ctx, view);
          }
          return false;
        },
      },
    })
);
