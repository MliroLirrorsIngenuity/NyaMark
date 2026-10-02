import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { indentAtLineStart } from '../src/editor/plugins/tab-focus';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    table: { group: 'block', content: 'table_row+' },
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph' },
    hardbreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
});

const p = (...parts: (string | Node)[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) => (typeof part === 'string' ? schema.text(part) : part))
  );
const br = () => schema.node('hardbreak');

/** The caret `offset` into the first textblock of `block`. */
function at(block: Node, offset: number) {
  const doc = schema.node('doc', null, [block]);
  let start = -1;
  doc.descendants((node, pos) => {
    if (start < 0 && node.isTextblock) start = pos + 1;
    return start < 0;
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, start + offset),
  });
}

describe('indentAtLineStart', () => {
  test('holds at the start of a paragraph or a heading', () => {
    expect(indentAtLineStart(at(p('text'), 0))).toBe(true);
    expect(
      indentAtLineStart(at(schema.node('heading', null, schema.text('h')), 0))
    ).toBe(true);
  });

  test('holds past spaces only, and after a line break', () => {
    expect(indentAtLineStart(at(p('  text'), 2))).toBe(true);
    expect(indentAtLineStart(at(p('one', br(), 'two'), 4))).toBe(true);
  });

  test('holds at the start of a line in a quote', () => {
    expect(
      indentAtLineStart(at(schema.node('blockquote', null, p('q')), 0))
    ).toBe(true);
  });

  test('lets the indent in further along a line', () => {
    expect(indentAtLineStart(at(p('text'), 2))).toBe(false);
    expect(indentAtLineStart(at(p('text'), 4))).toBe(false);
    expect(indentAtLineStart(at(p('one', br(), 'two'), 5))).toBe(false);
  });

  test('leaves lists and tables to their own Tab', () => {
    const list = schema.node('bullet_list', null, [
      schema.node('list_item', null, [p('a')]),
    ]);
    expect(indentAtLineStart(at(list, 0))).toBe(false);
    const table = schema.node('table', null, [
      schema.node('table_row', null, [schema.node('table_cell', null, p('c'))]),
    ]);
    expect(indentAtLineStart(at(table, 0))).toBe(false);
  });
});
