import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import {
  caretPastSelectedBlock,
  insertBlocks,
} from '../src/editor/plugins/insert-blocks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    'image-block': { group: 'block', atom: true },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const img = () => schema.node('image-block');
const item = (...content: Node[]) => schema.node('list_item', null, content);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** An image put in at `offset` into the line `line`. */
function paste(start: Node, line: string, offset = line.length) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === line)
      at = pos + 1 + offset;
    return at < 0;
  });
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
  });
  const tr = insertBlocks(state, [img()]);
  if (!tr) return null;
  const { $head } = tr.selection;
  return {
    doc: tr.doc,
    caret: `${$head.parent.textContent}@${$head.parentOffset}`,
  };
}

describe('an image put in at the caret', () => {
  test('takes the place of an empty line, the caret on a new line under it', () => {
    const out = paste(doc(p('a'), p()), '');
    expect(out?.doc.eq(doc(p('a'), img(), p()))).toBe(true);
    expect(out?.caret).toBe('@0');
  });

  test('uses the empty line already under it', () => {
    const out = paste(doc(p(), p()), '');
    expect(out?.doc.eq(doc(img(), p()))).toBe(true);
  });

  test('goes under a line it is pasted at the end of', () => {
    const out = paste(doc(p('ab'), p('c')), 'ab');
    expect(out?.doc.eq(doc(p('ab'), img(), p(), p('c')))).toBe(true);
    expect(out?.caret).toBe('@0');
  });

  test('splits a line, the caret in front of its rest', () => {
    const out = paste(doc(p('abcd')), 'abcd', 2);
    expect(out?.doc.eq(doc(p('ab'), img(), p('cd')))).toBe(true);
    expect(out?.caret).toBe('cd@0');
  });

  test('goes above a line it is pasted at the start of', () => {
    const out = paste(doc(p('ab')), 'ab', 0);
    expect(out?.doc.eq(doc(img(), p('ab')))).toBe(true);
    expect(out?.caret).toBe('ab@0');
  });

  test('from an empty item, goes under the item above', () => {
    const out = paste(doc(list(item(p('a')), item(p()))), '');
    expect(out?.doc.eq(doc(list(item(p('a'), img(), p()))))).toBe(true);
  });

  test('at the end of an item, stays in it', () => {
    const out = paste(doc(list(item(p('a')), item(p('b')))), 'a');
    expect(out?.doc.eq(doc(list(item(p('a'), img(), p()), item(p('b')))))).toBe(
      true
    );
  });
});

test('a block left selected gives the caret to the line after it', () => {
  const start = doc(p('a'), img());
  const state = EditorState.create({
    doc: start,
    selection: NodeSelection.create(start, 3),
  });
  const tr = caretPastSelectedBlock(state.tr);
  expect(tr.doc.eq(doc(p('a'), img(), p()))).toBe(true);
  expect(tr.selection.$head.parent.type.name).toBe('paragraph');
  expect(tr.selection.head).toBe(5);
});
