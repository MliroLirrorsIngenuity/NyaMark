import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { typeOver } from '../src/editor/plugins/type-over-blocks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    heading: { group: 'block', content: 'text*', defining: true },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*', defining: true },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const h = (text: string) => schema.node('heading', null, [schema.text(text)]);
const item = (...content: Node[]) => schema.node('list_item', null, content);
const list = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Where `offset` falls in the first textblock reading `line`. */
function at(start: Node, line: string, offset: number) {
  let pos = -1;
  start.descendants((node, nodePos) => {
    if (pos < 0 && node.isTextblock && node.textContent === line) {
      pos = nodePos + 1 + offset;
    }
    return pos < 0;
  });
  return pos;
}

function typed(start: Node, from: number, to: number, text = 'a') {
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, from, to),
  });
  return typeOver(state, text);
}

describe('typing over a selection across blocks', () => {
  const start = doc(
    h('标题'),
    p('正文'),
    list(item(p('列表一')), item(p('列表二'), list(item(p('嵌套')))))
  );

  test('goes where Backspace leaves the caret, the item kept whole', () => {
    const tr = typed(start, at(start, '正文', 0), at(start, '列表二', 0));
    expect(
      tr?.doc.eq(
        doc(h('标题'), list(item(p('a列表二'), list(item(p('嵌套'))))))
      )
    ).toBe(true);
    expect(tr?.selection.$head.parentOffset).toBe(1);
  });

  test('joins the lines it runs between', () => {
    const tr = typed(start, at(start, '标题', 1), at(start, '正文', 1));
    expect(
      tr?.doc.eq(
        doc(
          h('标a文'),
          list(item(p('列表一')), item(p('列表二'), list(item(p('嵌套')))))
        )
      )
    ).toBe(true);
  });

  test('leaves a selection in one line to the editor', () => {
    expect(typed(start, at(start, '正文', 0), at(start, '正文', 2))).toBeNull();
    const caret = at(start, '正文', 1);
    expect(typed(start, caret, caret)).toBeNull();
  });
});
