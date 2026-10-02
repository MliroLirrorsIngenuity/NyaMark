import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { splitDoneTask } from '../src/editor/plugins/list-enter';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      attrs: { checked: { default: null } },
    },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const task = (checked: boolean | null, text: string) =>
  schema.node('list_item', { checked }, p(text));
const bullets = (...items: Node[]) => schema.node('bullet_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Enter with the caret at `pos`. */
const enterAt = (start: Node, pos: number) =>
  splitDoneTask(
    EditorState.create({
      doc: start,
      selection: TextSelection.create(start, pos),
    }),
    schema.nodes.list_item
  );

describe('Enter in a task ticked off', () => {
  // The list opens at 0, the item at 1, its text at 3.
  test('leaves the task added under it open', () => {
    const tr = enterAt(doc(bullets(task(true, 'done'))), 7);
    expect(tr?.doc.toJSON()).toEqual(
      doc(bullets(task(true, 'done'), task(false, ''))).toJSON()
    );
    expect(tr?.selection.from).toBe(11);
  });

  test('leaves the text after the caret in an open task', () => {
    expect(enterAt(doc(bullets(task(true, 'done'))), 5)?.doc.toJSON()).toEqual(
      doc(bullets(task(true, 'do'), task(false, 'ne'))).toJSON()
    );
  });

  test('opens the empty task left above from the start of it', () => {
    const tr = enterAt(doc(bullets(task(true, 'done'))), 3);
    expect(tr?.doc.toJSON()).toEqual(
      doc(bullets(task(false, ''), task(true, 'done'))).toJSON()
    );
    expect(tr?.selection.$from.parent.textContent).toBe('done');
  });

  test('is left to the list for other items', () => {
    expect(enterAt(doc(bullets(task(false, 'open'))), 7)).toBeNull();
    expect(enterAt(doc(bullets(task(null, 'item'))), 7)).toBeNull();
  });
});
