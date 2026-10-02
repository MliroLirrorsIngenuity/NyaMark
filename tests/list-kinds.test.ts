import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { splitMixedLists } from '../src/editor/plugins/list-kinds';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { spread: { default: false } },
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { order: { default: 1 }, spread: { default: false } },
    },
    list_item: {
      content: 'paragraph block*',
      attrs: {
        label: { default: '•' },
        listType: { default: 'bullet' },
        spread: { default: true },
        checked: { default: null },
      },
    },
    text: {},
  },
});

const p = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
const bullet = (text: string, ...rest: Node[]) =>
  schema.node('list_item', null, [p(text), ...rest]);
const number = (n: number, text: string) =>
  schema.node('list_item', { label: `${n}.`, listType: 'ordered' }, [p(text)]);
const bullets = (...items: Node[]) =>
  schema.node('bullet_list', { spread: 'false' }, items);

/** Each list as its kind and its items' labels and text. */
function lists(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name.endsWith('_list')) {
      const items = node.content.content.map(
        (item) => `${item.attrs.label}${item.firstChild?.textContent}`
      );
      out.push(`${node.type.name}: ${items.join(' ')}`);
    }
    return !node.isTextblock;
  });
  return out;
}

function split(...blocks: Node[]) {
  const doc = schema.node('doc', null, blocks);
  const state = EditorState.create({ doc });
  return splitMixedLists(state);
}

describe('splitMixedLists', () => {
  test('puts numbered items left in a bulleted list in a list of their own', () => {
    const tr = split(bullets(bullet('列X序一'), number(2, '有序二')));
    expect(tr && lists(tr.doc)).toEqual([
      'bullet_list: •列X序一',
      'ordered_list: 1.有序二',
    ]);
    expect(tr?.doc.child(1).attrs).toEqual({ order: 1, spread: 'false' });
  });

  test('keeps the bulleted items after them in a bulleted list', () => {
    const tr = split(
      bullets(bullet('a'), number(2, 'b'), number(3, 'c'), bullet('d'))
    );
    expect(tr && lists(tr.doc)).toEqual([
      'bullet_list: •a',
      'ordered_list: 1.b 2.c',
      'bullet_list: •d',
    ]);
  });

  test('splits a list nested in an item', () => {
    const tr = split(
      bullets(bullet('a', bullets(bullet('b'), number(2, 'c'))))
    );
    expect(tr && lists(tr.doc)).toEqual([
      'bullet_list: •a',
      'bullet_list: •b',
      'ordered_list: 1.c',
    ]);
  });

  test('keeps the caret where it was', () => {
    const doc = schema.node('doc', null, [
      bullets(bullet('ab'), number(2, 'cd')),
    ]);
    // In `cd`, after its `c`.
    const at = 10;
    expect(doc.textBetween(at - 1, at)).toBe('c');
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, at),
    });
    const tr = splitMixedLists(state);
    const { $head } = tr?.selection ?? state.selection;
    expect($head.parent.textContent).toBe('cd');
    expect($head.parentOffset).toBe(1);
  });

  test('leaves lists of one kind', () => {
    expect(split(bullets(bullet('a'), bullet('b')))).toBeNull();
    const numbers = schema.node('ordered_list', null, [
      number(1, 'a'),
      number(2, 'b'),
    ]);
    expect(split(numbers)).toBeNull();
  });
});
