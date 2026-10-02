import { describe, expect, test } from 'bun:test';
import {
  type InputRule,
  inputRules,
  wrappingInputRule,
} from '@milkdown/kit/prose/inputrules';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import {
  type Typed,
  giveBackTyped,
  typedAfter,
} from '../src/editor/plugins/undo-lines';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    text: {},
  },
});

const p = (text = '') =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

const QUOTE = /^>\s$/;
const rule = wrappingInputRule(QUOTE, schema.nodes.blockquote);
const rules = inputRules({ rules: [rule] });
// An empty line kept at the end, as Milkdown's trailing plugin keeps one.
const trailing = new Plugin({
  appendTransaction(_trs, _old, state) {
    if (state.doc.lastChild?.type.name === 'paragraph') return null;
    return state.tr.insert(state.doc.content.size, p());
  },
});
const key = new PluginKey<Typed | null>('typed');
const record = new Plugin<Typed | null>({
  key,
  state: {
    init: () => null,
    apply: (tr, typed, old, state) => typedAfter(typed, tr, old, state),
  },
});

/** The space typed after `>`, as the rule takes it. */
function typeQuote(): EditorState {
  const start = doc(p('>'));
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, 2),
    plugins: [rules, trailing, record],
  });
  const handler = (rule as InputRule & { handler: unknown }).handler as (
    state: EditorState,
    match: RegExpExecArray,
    from: number,
    to: number
  ) => Transaction;
  const match = QUOTE.exec('> ');
  if (!match) throw new Error('no match');
  const tr = handler(state, match, 1, 2);
  tr.setMeta(rules, { transform: tr, from: 2, to: 2, text: ' ' });
  return state.apply(tr);
}

describe('Cmd+Z straight after Markdown became a block', () => {
  test('gives back what was typed, with the line put in after it gone', () => {
    const state = typeQuote();
    expect(state.doc.childCount).toBe(2);
    const typed = key.getState(state);
    if (!typed) throw new Error('no record');
    const back = state.apply(giveBackTyped(state, typed));
    expect(back.doc.eq(doc(p('> ')))).toBe(true);
    expect(back.selection.head).toBe(3);
  });

  test('can still, after the caret is set again where it is', () => {
    const state = typeQuote();
    const head = TextSelection.create(state.doc, state.selection.head);
    expect(key.getState(state.apply(state.tr.setSelection(head)))).toBeTruthy();
  });

  test('cannot, once the caret moves or more is typed', () => {
    const state = typeQuote();
    const end = TextSelection.create(state.doc, state.doc.content.size - 1);
    expect(key.getState(state.apply(state.tr.setSelection(end)))).toBeNull();
    expect(key.getState(state.apply(state.tr.insertText('a')))).toBeNull();
  });
});
