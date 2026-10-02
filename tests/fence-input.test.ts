import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { fenceFromLine } from '../src/editor/plugins/fence-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { language: { default: '' } },
    },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const item = (...content: Node[]) => schema.node('list_item', null, content);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Enter at the end of the line `line`, the first one found. */
function enterAfter(start: Node, line: string) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === line)
      at = pos + 1 + node.content.size;
    return at < 0;
  });
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
  });
  const tr = fenceFromLine(state);
  if (!tr) return null;
  return { doc: tr.doc, caret: tr.selection.$head.parent.type.name };
}

describe('a fence typed on a line of its own', () => {
  test('starts a code block in its place', () => {
    const out = enterAfter(doc(p('a'), p('```')), '```');
    expect(out?.doc.eq(doc(p('a'), schema.node('code_block')))).toBe(true);
    expect(out?.caret).toBe('code_block');
  });

  test('keeps any language name without a space', () => {
    const out = enterAfter(doc(p('```C++')), '```C++');
    expect(out?.doc.firstChild?.attrs.language).toBe('C++');
  });

  test('stays text with a space after the name or the caret before the end', () => {
    expect(enterAfter(doc(p('```js x')), '```js x')).toBeNull();
    const start = doc(p('```'));
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, 2),
    });
    expect(fenceFromLine(state)).toBeNull();
  });
});

describe('a fence typed in a list item', () => {
  test('goes under the item above', () => {
    const out = enterAfter(doc(list(item(p('a')), item(p('```')))), '```');
    expect(
      out?.doc.eq(doc(list(item(p('a'), schema.node('code_block')))))
    ).toBe(true);
    expect(out?.caret).toBe('code_block');
  });

  test('from the only item, takes the place of the list', () => {
    const out = enterAfter(doc(list(item(p('```'))), p('b')), '```');
    expect(out?.doc.eq(doc(schema.node('code_block'), p('b')))).toBe(true);
  });

  test('from the first item, goes in front of the list', () => {
    const out = enterAfter(doc(list(item(p('```')), item(p('a')))), '```');
    expect(
      out?.doc.eq(doc(schema.node('code_block'), list(item(p('a')))))
    ).toBe(true);
  });

  test('starts a formula from `$$` as well', () => {
    const out = enterAfter(doc(list(item(p('a')), item(p('$$')))), '$$');
    const formula = schema.node('code_block', { language: 'LaTeX' });
    expect(out?.doc.eq(doc(list(item(p('a'), formula))))).toBe(true);
    expect(enterAfter(doc(p('$$ x')), '$$ x')).toBeNull();
  });

  test('leaves an item with more under it to the list', () => {
    const start = doc(list(item(p('a')), item(p('```'), p('c'))));
    expect(enterAfter(start, '```')).toBeNull();
  });
});
