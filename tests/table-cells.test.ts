import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import {
  backspaceEmptyRow,
  isEmptyRow,
  keepsCellCaret,
  prevCell,
  rowCells,
} from '../src/editor/plugins/table-cells';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    hr: { group: 'block' },
    table: { group: 'block', content: 'table_row+', tableRole: 'table' },
    table_row: { content: '(table_header | table_cell)+', tableRole: 'row' },
    table_header: { content: 'paragraph', tableRole: 'header_cell' },
    table_cell: { content: 'paragraph', tableRole: 'cell' },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
});

const p = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
const cell = (type: string, text: string) => schema.node(type, null, [p(text)]);
const row = (...cells: Node[]) => schema.node('table_row', null, cells);

// <table>0 <tr>1 <th>2 <p>3 名称 </p></th></tr> <tr>9 <td>10 <p>11 苹果 ...
const doc = schema.node('doc', null, [
  schema.node('table', null, [
    row(cell('table_header', '名称')),
    row(cell('table_cell', '苹果')),
  ]),
  schema.node('hr'),
  p('after'),
]);

const state = EditorState.create({ doc });

describe('a click in a table cell', () => {
  test('keeps the caret instead of selecting the cell paragraph', () => {
    for (const pos of [3, 11]) {
      const tr = state.tr.setSelection(NodeSelection.create(doc, pos));
      expect(tr.selection.$from.parent.type.name).toMatch(/^table_/);
      expect(keepsCellCaret(tr)).toBe(false);
    }
  });

  test('leaves every other selection alone', () => {
    const hr = doc.child(0).nodeSize;
    expect(
      keepsCellCaret(state.tr.setSelection(NodeSelection.create(doc, hr)))
    ).toBe(true);
    expect(
      keepsCellCaret(state.tr.setSelection(NodeSelection.create(doc, 0)))
    ).toBe(true);
    expect(
      keepsCellCaret(state.tr.setSelection(TextSelection.create(doc, 12, 14)))
    ).toBe(true);
    expect(keepsCellCaret(state.tr.insertText('x', 12))).toBe(true);
  });
});

describe('a line typed as a table row', () => {
  const cells = (line: Node) =>
    rowCells(line)?.map((cell) => cell.textBetween(0, cell.size));

  test('gives the text between each pair of bars, trimmed', () => {
    expect(cells(p('| 名称 | 数量 |'))).toEqual(['名称', '数量']);
    expect(cells(p('|a|b|c|'))).toEqual(['a', 'b', 'c']);
    expect(cells(p('  | 一 |  '))).toEqual(['一']);
    expect(cells(p('| a |  | b |'))).toEqual(['a', '', 'b']);
  });

  test('keeps the marks on the text', () => {
    const bold = schema.text('名称', [schema.mark('strong')]);
    const line = schema.node('paragraph', null, [
      schema.text('| '),
      bold,
      schema.text(' | 数量 |'),
    ]);
    const first = rowCells(line)?.[0];
    expect(first?.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      'strong',
    ]);
  });

  test('is not any other line', () => {
    for (const text of ['a | b', '| a | b', 'a | b |', '|', '| |', '|  |  |']) {
      expect(rowCells(p(text))).toBeNull();
    }
    expect(rowCells(schema.node('paragraph'))).toBeNull();
  });
});

describe('a row Enter leaves the table from', () => {
  const blank = schema.node('table_cell', null, [schema.node('paragraph')]);

  test('has nothing typed in any of its cells', () => {
    expect(isEmptyRow(row(blank, blank))).toBe(true);
    expect(isEmptyRow(row(blank, cell('table_cell', ' ')))).toBe(false);
    expect(isEmptyRow(row(cell('table_cell', '苹果'), blank))).toBe(false);
  });
});

describe('Shift+Tab in a table', () => {
  const at = (pos: number) =>
    state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));

  test('goes to the cell before', () => {
    const from = at(13);
    const moved: EditorState[] = [];
    expect(prevCell(from, (tr) => moved.push(from.apply(tr)))).toBe(true);
    expect(moved[0]?.selection.$head.parent.textContent).toBe('名称');
  });

  test('stays put in the first cell, the key taken all the same', () => {
    const moved: unknown[] = [];
    expect(prevCell(at(4), (tr) => moved.push(tr))).toBe(true);
    expect(moved).toHaveLength(0);
  });

  test('is left to others outside a table', () => {
    expect(prevCell(at(doc.content.size - 2))).toBe(false);
  });
});

describe('Backspace in a table', () => {
  const blank = schema.node('table_cell', null, [schema.node('paragraph')]);
  const blankHead = schema.node('table_header', null, [
    schema.node('paragraph'),
  ]);
  const head = row(cell('table_header', '名称'), cell('table_header', '数量'));
  const filled = row(cell('table_cell', '苹果'), cell('table_cell', '3'));
  const table = (...rows: Node[]) => schema.node('table', null, rows);

  /** Backspace with the caret in cell `column` of row `line` of the table. */
  const backspace = (start: Node, line: number, column: number) => {
    let at = -1;
    start.descendants((node, pos) => {
      if (node.type.name !== 'table') return at < 0;
      let row = pos + 1;
      for (let index = 0; index < line; index += 1) {
        row += node.child(index).nodeSize;
      }
      let cellPos = row + 1;
      for (let index = 0; index < column; index += 1) {
        cellPos += node.child(line).child(index).nodeSize;
      }
      at = cellPos + 2;
      return false;
    });
    const from = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, at),
    });
    let next: EditorState | null = null;
    const taken = backspaceEmptyRow(from, (tr) => {
      next = from.apply(tr);
    });
    return { taken, next: next as EditorState | null };
  };
  const rows = (state: EditorState | null) =>
    state?.doc.firstChild?.type.name === 'table'
      ? state.doc.firstChild.childCount
      : 0;

  test('takes an empty row away, the caret to the end of the row above', () => {
    const start = schema.node('doc', null, [
      table(head, filled, row(blank, blank)),
      p('after'),
    ]);
    for (const column of [0, 1]) {
      const { taken, next } = backspace(start, 2, column);
      expect(taken).toBe(true);
      expect(rows(next)).toBe(2);
      expect(next?.selection.$head.parent.textContent).toBe('3');
      expect(next?.selection.$head.parentOffset).toBe(1);
    }
  });

  test('keeps the one row under a header with words, going up to it', () => {
    const start = schema.node('doc', null, [table(head, row(blank, blank))]);
    const { taken, next } = backspace(start, 1, 0);
    expect(taken).toBe(true);
    expect(rows(next)).toBe(2);
    expect(next?.selection.$head.parent.textContent).toBe('数量');
  });

  test('takes an empty table away, the caret to the line above', () => {
    const start = schema.node('doc', null, [
      p('before'),
      table(row(blankHead, blankHead), row(blank, blank)),
      p('after'),
    ]);
    const { taken, next } = backspace(start, 1, 1);
    expect(taken).toBe(true);
    expect(next?.doc.childCount).toBe(2);
    expect(next?.selection.$head.parent.textContent).toBe('before');
    expect(next?.selection.$head.parentOffset).toBe(6);
  });

  test('leaves a line in place of an empty table that opens the document', () => {
    const start = schema.node('doc', null, [table(row(blankHead), row(blank))]);
    const { taken, next } = backspace(start, 0, 0);
    expect(taken).toBe(true);
    expect(next?.doc.toString()).toBe('doc(paragraph)');
    expect(next?.selection.$head.parent.type.name).toBe('paragraph');
  });

  test('leaves a row with words in it, and an empty header, to others', () => {
    const start = schema.node('doc', null, [
      table(row(blankHead, blankHead), filled, row(blank, blank)),
    ]);
    expect(backspace(start, 1, 0).taken).toBe(false);
    expect(backspace(start, 0, 0).taken).toBe(false);
  });
});
