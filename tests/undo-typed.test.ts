import { describe, expect, test } from 'bun:test';
import { inputRules, wrappingInputRule } from '@milkdown/kit/prose/inputrules';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
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
  const view = {
    state: EditorState.create({
      doc: start,
      selection: TextSelection.create(start, 2),
      plugins: [rules, trailing, record],
    }),
    composing: false,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const insert = () => view.state.tr.insertText(' ', 2, 2);
  const handled = rules.props.handleTextInput?.call(
    rules,
    view as unknown as EditorView,
    2,
    2,
    ' ',
    insert
  );
  if (!handled) throw new Error('no rule');
  return view.state;
}

describe('Cmd+Z straight after Markdown became a block', () => {
  test('gives back what was typed, with the line put in after it gone', () => {
    const state = typeQuote();
    expect(state.doc.childCount).toBe(2);
    const typed = key.getState(state);
    if (!typed) throw new Error('no record');
    const tr = giveBackTyped(state, typed);
    if (!tr) throw new Error('nothing given back');
    const back = state.apply(tr);
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
