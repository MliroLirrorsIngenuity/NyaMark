import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import {
  type ListKind,
  inQuote,
  liftFromQuote,
  listAt,
  toggleList,
} from '../src/editor/plugins/toolbar-toggles';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
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

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const quote = (...content: Node[]) => schema.node('blockquote', null, content);
const item = (...content: Node[]) => schema.node('list_item', null, content);
const task = (...content: Node[]) =>
  schema.node('list_item', { checked: false }, content);
const ul = (...items: Node[]) => schema.node('bullet_list', null, items);
const ol = (...items: Node[]) => schema.node('ordered_list', null, items);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** A state with the caret at the end of the line `line`. */
function at(start: Node, line: string) {
  let pos = -1;
  start.descendants((node, offset) => {
    if (pos < 0 && node.isTextblock && node.textContent === line)
      pos = offset + 1 + node.content.size;
    return pos < 0;
  });
  return EditorState.create({
    doc: start,
    selection: TextSelection.create(start, pos),
  });
}

function run(
  command: (state: EditorState, dispatch: (tr: Transaction) => void) => void,
  state: EditorState
) {
  const done: Transaction[] = [];
  command(state, (tr) => done.push(tr));
  return done[0]?.doc;
}

const toggle = (state: EditorState, kind: ListKind) =>
  run((s, d) => toggleList(s, kind, d), state);

describe('the list the caret is in', () => {
  test('is the innermost one, with its kind', () => {
    const start = doc(ul(item(p('a'), ol(item(p('b'))))));
    expect(listAt(at(start, 'a'))).toEqual({ depth: 1, kind: 'bullet' });
    expect(listAt(at(start, 'b'))).toEqual({ depth: 3, kind: 'ordered' });
    expect(listAt(at(doc(ul(task(p('c')))), 'c'))?.kind).toBe('task');
  });

  test('is none outside a list', () => {
    expect(listAt(at(doc(p('a')), 'a'))).toBeNull();
  });
});

describe('a list button in a list', () => {
  test('of another kind makes the whole list that kind', () => {
    const out = toggle(at(doc(ul(item(p('a')), item(p('b')))), 'b'), 'ordered');
    expect(out?.firstChild?.type.name).toBe('ordered_list');
    expect(out?.firstChild?.child(1).attrs.label).toBe('2.');
    expect(out?.firstChild?.child(1).attrs.listType).toBe('ordered');
  });

  test('makes a list of tasks, and back', () => {
    const tasks = toggle(at(doc(ol(item(p('a')), item(p('b')))), 'a'), 'task');
    expect(tasks?.eq(doc(ul(task(p('a')), task(p('b')))))).toBe(true);
    const back = tasks && toggle(at(tasks, 'a'), 'bullet');
    expect(back?.eq(doc(ul(item(p('a')), item(p('b')))))).toBe(true);
  });

  test('of its own kind takes the item out of the list', () => {
    const out = toggle(at(doc(ul(item(p('a')), item(p('b')))), 'b'), 'bullet');
    expect(out?.eq(doc(ul(item(p('a'))), p('b')))).toBe(true);
  });

  test('is left to the toolbar outside a list', () => {
    expect(toggleList(at(doc(p('a')), 'a'), 'bullet')).toBe(false);
  });
});

describe('the quote button in a quote', () => {
  test('takes the line out of the quote', () => {
    const state = at(doc(quote(p('a'), p('b'))), 'b');
    expect(inQuote(state)).toBe(true);
    const out = run(liftFromQuote, state);
    expect(out?.eq(doc(quote(p('a')), p('b')))).toBe(true);
  });

  test('takes a list out of the quote it is in', () => {
    const out = run(liftFromQuote, at(doc(quote(ul(item(p('a'))))), 'a'));
    expect(out?.eq(doc(ul(item(p('a')))))).toBe(true);
  });

  test('is left to the toolbar outside a quote', () => {
    const state = at(doc(p('a')), 'a');
    expect(inQuote(state)).toBe(false);
    expect(liftFromQuote(state)).toBe(false);
  });
});
