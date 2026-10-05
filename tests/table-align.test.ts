import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  alignCellsToHeaders,
  alignmentFromDOM,
} from '../src/editor/plugins/table-align';

/** A cell as the parser sees it: its style and its attributes. */
function cell(textAlign: string, align: string | null = null) {
  return {
    style: { textAlign },
    getAttribute: (name: string) => (name === 'align' ? align : null),
  } as unknown as HTMLElement;
}

describe('alignmentFromDOM', () => {
  test('reads the alignment a cell is drawn with', () => {
    expect(alignmentFromDOM(cell('center'))).toBe('center');
    expect(alignmentFromDOM(cell(''))).toBeNull();
  });

  test('reads the align attribute of a page made from Markdown', () => {
    expect(alignmentFromDOM(cell('', 'center'))).toBe('center');
    expect(alignmentFromDOM(cell('', 'RIGHT'))).toBe('right');
    expect(alignmentFromDOM(cell('', 'justify'))).toBeNull();
  });
});

const aligned = { alignment: { default: null } };
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    table: {
      group: 'block',
      content: 'table_header_row table_row*',
    },
    table_header_row: { content: 'table_header+' },
    table_row: { content: 'table_cell+' },
    table_header: { content: 'paragraph', attrs: aligned },
    table_cell: { content: 'paragraph', attrs: aligned },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const cellOf = (type: string, text: string, alignment: string | null = null) =>
  schema.node(type, { alignment }, [p(text)]);
const table = (header: (string | null)[], ...rows: (string | null)[][]) =>
  schema.node('table', null, [
    schema.node(
      'table_header_row',
      null,
      header.map((align, i) => cellOf('table_header', `h${i}`, align))
    ),
    ...rows.map((row) =>
      schema.node(
        'table_row',
        null,
        row.map((align, i) => cellOf('table_cell', `c${i}`, align))
      )
    ),
  ]);

const alignments = (doc: Node) => {
  const out: (string | null)[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'table_cell') out.push(node.attrs.alignment);
    return true;
  });
  return out;
};

const doc = schema.node('doc', null, [
  p('before'),
  table(['center', null], ['center', null], ['center', null]),
  schema.node('blockquote', null, [table(['right'], ['right'])]),
  p('after'),
]);
const state = EditorState.create({ doc });

describe('cells keep their column alignment', () => {
  test('typing hands back nothing', () => {
    const typed = state.apply(state.tr.insertText('x', 3));
    expect(alignCellsToHeaders(state, typed)).toBeNull();
    let pos = -1;
    doc.descendants((node, at) => {
      if (pos < 0 && node.type.name === 'table_cell') pos = at + 2;
      return pos < 0;
    });
    expect(doc.resolve(pos).node(-1).type.name).toBe('table_cell');
    const inCell = state.apply(state.tr.insertText('x', pos));
    expect(alignCellsToHeaders(state, inCell)).toBeNull();
  });

  test('a header realigned takes its column with it', () => {
    const headerPos = doc.child(0).nodeSize + 2;
    const header = doc.nodeAt(headerPos);
    expect(header?.type.name).toBe('table_header');
    const next = state.apply(
      state.tr.setNodeMarkup(headerPos, undefined, {
        ...header?.attrs,
        alignment: 'right',
      })
    );
    const tr = alignCellsToHeaders(state, next);
    if (!tr) throw new Error('the cells were left as they were');
    expect(alignments(next.apply(tr).doc)).toEqual([
      'right',
      null,
      'right',
      null,
      'right',
    ]);
  });

  test('a row pasted in a quoted table is aligned', () => {
    const quote = doc.child(0).nodeSize + doc.child(1).nodeSize;
    const inner = doc.nodeAt(quote + 1);
    expect(inner?.type.name).toBe('table');
    const end = quote + 1 + (inner?.nodeSize ?? 0) - 1;
    const row = schema.node('table_row', null, [cellOf('table_cell', 'new')]);
    const next = state.apply(state.tr.insert(end, row));
    const tr = alignCellsToHeaders(state, next);
    if (!tr) throw new Error('the cells were left as they were');
    expect(alignments(next.apply(tr).doc)).toEqual([
      'center',
      null,
      'center',
      null,
      'right',
      'right',
    ]);
  });
});
