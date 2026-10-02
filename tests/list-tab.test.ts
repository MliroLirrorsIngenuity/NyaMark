import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { itemsStayPut } from '../src/editor/plugins/list-tab';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*', defining: true },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const item = (...blocks: Node[]) => schema.node('list_item', null, blocks);
const bullets = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Tab with the caret at the start of the textblock holding `text`. */
function tabAt(start: Node, text: string) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1;
    return at < 0;
  });
  return itemsStayPut(
    EditorState.create({
      doc: start,
      selection: TextSelection.create(start, at),
    }),
    schema.nodes.list_item
  );
}

describe('Tab in a list', () => {
  test('holds an item that cannot go further in', () => {
    expect(tabAt(doc(bullets(item(p('a')))), 'a')).toBe(true);
    expect(tabAt(doc(bullets(item(p('a'), bullets(item(p('b')))))), 'b')).toBe(
      true
    );
  });

  test('leaves an item that can go in to the list', () => {
    expect(tabAt(doc(bullets(item(p('a')), item(p('b')))), 'b')).toBe(false);
  });

  test('leaves text outside a list alone', () => {
    expect(tabAt(doc(p('a')), 'a')).toBe(false);
  });
});
