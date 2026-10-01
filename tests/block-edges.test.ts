import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  backspaceAtBlockStart,
  deleteAtBlockEnd,
} from '../src/editor/plugins/block-edges';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    code_block: { group: 'block', content: 'text*', code: true },
    bullet_list: { group: 'block', content: 'list_item+' },
    ordered_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*', defining: true },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const code = (text: string) =>
  schema.node('code_block', null, schema.text(text));
const item = (...blocks: Node[]) => schema.node('list_item', null, blocks);
const bullets = (...items: Node[]) => schema.node('bullet_list', null, items);
const numbers = (...items: Node[]) => schema.node('ordered_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** A state with the caret at the start or end of the textblock holding `text`. */
function caretAt(start: Node, text: string, end = false) {
  let at = -1;
  start.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) {
      at = pos + 1 + (end ? node.content.size : 0);
    }
    return at < 0;
  });
  return EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
  });
}

const backspaceBefore = (start: Node, text: string) =>
  backspaceAtBlockStart(caretAt(start, text));
const deleteAfter = (start: Node, text: string) =>
  deleteAtBlockEnd(caretAt(start, text, true));

describe('backspaceAtBlockStart', () => {
  test('takes the first item out of its list', () => {
    const start = doc(
      bullets(item(p('a'))),
      numbers(item(p('one')), item(p('two')))
    );
    expect(backspaceBefore(start, 'one')?.doc.toJSON()).toEqual(
      doc(bullets(item(p('a'))), p('one'), numbers(item(p('two')))).toJSON()
    );
  });

  test('leaves later and nested items to the join', () => {
    const start = doc(
      bullets(item(p('a'), bullets(item(p('b')))), item(p('c')))
    );
    expect(backspaceBefore(start, 'b')).toBeNull();
    expect(backspaceBefore(start, 'c')).toBeNull();
  });

  test('takes the first paragraph out of its quote', () => {
    const start = doc(p('above'), quote(p('q1'), p('q2')));
    expect(backspaceBefore(start, 'q1')?.doc.toJSON()).toEqual(
      doc(p('above'), p('q1'), quote(p('q2'))).toJSON()
    );
    expect(backspaceBefore(start, 'q2')).toBeNull();
  });

  test('moves into the code above without joining it', () => {
    const start = doc(code('let x'), p('after'));
    const tr = backspaceBefore(start, 'after');
    expect(tr?.docChanged).toBe(false);
    expect(tr?.selection.from).toBe(1 + 'let x'.length);
  });

  test('leaves an empty paragraph after code to the join', () => {
    expect(backspaceBefore(doc(code('x'), p('')), '')).toBeNull();
  });

  test('ignores a caret inside the text', () => {
    const start = doc(p('above'), quote(p('q1')));
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, 10),
    });
    expect(backspaceAtBlockStart(state)).toBeNull();
  });
});

describe('deleteAtBlockEnd', () => {
  test('moves into the code below without joining it', () => {
    const start = doc(p('before'), code('let x'));
    const tr = deleteAfter(start, 'before');
    expect(tr?.docChanged).toBe(false);
    expect(tr?.selection.from).toBe('before'.length + 3);
  });

  test('removes an empty paragraph above code', () => {
    const tr = deleteAfter(doc(p('a'), p(''), code('x')), '');
    expect(tr?.doc.toJSON()).toEqual(doc(p('a'), code('x')).toJSON());
    expect(tr?.selection.from).toBe(4);
  });

  test('leaves other blocks to the join', () => {
    expect(deleteAfter(doc(p('a'), p('b')), 'a')).toBeNull();
    expect(deleteAfter(doc(p('a'), quote(p('b'))), 'a')).toBeNull();
  });
});
