import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { QUOTE, typedQuoteInItem } from '../src/editor/plugins/quote-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const quote = (...content: Node[]) => schema.node('blockquote', null, content);
const item = (...content: Node[]) => schema.node('list_item', null, content);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** The space typed after the `>` that starts the line `line`. */
function type(start: Node, line: string) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === line) at = pos + 1;
    return at < 0;
  });
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at + 1),
  });
  const match = '> '.match(QUOTE);
  if (!match) throw new Error('no match');
  const tr = typedQuoteInItem(state, match, at, at + 1);
  return tr && { doc: tr.doc, head: tr.selection.$head };
}

describe('`> ` typed at the start of a list item', () => {
  test('starts a quote under the item above', () => {
    const out = type(doc(list(item(p('a')), item(p('>b')))), '>b');
    expect(out?.doc.eq(doc(list(item(p('a'), quote(p('b'))))))).toBe(true);
    expect(out?.head.parent.textContent).toBe('b');
    expect(out?.head.parentOffset).toBe(0);
  });

  test('from the only item, takes the place of the list', () => {
    const out = type(doc(list(item(p('>a')))), '>a');
    expect(out?.doc.eq(doc(quote(p('a'))))).toBe(true);
  });

  test('is left to Milkdown anywhere else', () => {
    expect(type(doc(p('>a')), '>a')).toBeNull();
    expect(type(doc(list(item(p('a'), p('>b')))), '>b')).toBeNull();
  });
});
