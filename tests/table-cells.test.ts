import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import { keepsCellCaret, rowCells } from '../src/editor/plugins/table-cells';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    hr: { group: 'block' },
    table: { group: 'block', content: 'table_row+' },
    table_row: { content: '(table_header | table_cell)+' },
    table_header: { content: 'paragraph' },
    table_cell: { content: 'paragraph' },
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
