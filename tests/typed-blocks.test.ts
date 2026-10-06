import { describe, expect, test } from 'bun:test';
import { history, undo } from '@milkdown/kit/prose/history';
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from '@milkdown/kit/prose/inputrules';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  type Plugin,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  lineAfterBreak,
  typedBlocksPlugin,
} from '../src/editor/plugins/typed-blocks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    blockquote: { group: 'block', content: 'block+' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: { group: 'inline' },
    hardbreak: {
      group: 'inline',
      inline: true,
      attrs: { isInline: { default: false } },
    },
  },
});

const { nodes } = schema;

const rules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({
      level: match[1]?.length ?? 1,
    })),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
    new InputRule(/\(c\)$/, '©'),
  ],
});

const heading = (level: number, text: string) =>
  schema.node('heading', { level }, schema.text(text));
const p = (text?: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

const lines = (...parts: (string | null)[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) =>
      part == null ? schema.node('hardbreak') : schema.text(part)
    )
  );

const reader = unified().use(remarkParse).use(remarkGfm);
const parse = (markdown: string) => reader.parse(markdown);

function stateAt(start: Node, at: number) {
  return EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
    plugins: [typedBlocksPlugin(parse), rules, history()],
  });
}

function viewOf(state: EditorState) {
  const view = {
    state,
    composing: false,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    someProp<T>(name: 'handleTextInput', f: (prop: T) => boolean) {
      for (const plugin of view.state.plugins as Plugin[]) {
        const prop = plugin.props[name] as T | undefined;
        if (prop && f(prop)) return true;
      }
      return false;
    },
  };
  return view;
}

function typeAt(start: Node, at: number, text = ' ') {
  const view = viewOf(stateAt(start, at));
  const insert = () => view.state.tr.insertText(text, at, at);
  const asView = view as unknown as EditorView;
  const handled = view.someProp(
    'handleTextInput',
    (
      handle: (
        view: EditorView,
        from: number,
        to: number,
        text: string,
        insert: () => Transaction
      ) => boolean
    ) => handle(asView, at, at, text, insert)
  );
  if (!handled) view.dispatch(insert());
  return view.state;
}

describe('typing after a line break', () => {
  test('makes a heading of the line', () => {
    const start = doc(lines('升级）', null, '###解决方法', null, '需要'));
    const state = typeAt(start, 8);
    expect(state.doc.toJSON()).toEqual(
      doc(p('升级）'), heading(3, '解决方法'), p('需要')).toJSON()
    );
    expect(state.selection.head).toBe(6);
  });

  test('takes the line to the end of the paragraph', () => {
    const state = typeAt(doc(lines('前', null, '##后')), 5);
    expect(state.doc.toJSON()).toEqual(doc(p('前'), heading(2, '后')).toJSON());
  });

  test('leaves no empty paragraph above a break that starts it', () => {
    const state = typeAt(doc(lines(null, '#x')), 3);
    expect(state.doc.toJSON()).toEqual(doc(heading(1, 'x')).toJSON());
    expect(state.selection.head).toBe(1);
  });

  test('makes a list or a quote of the line', () => {
    const list = typeAt(doc(lines('前', null, '-后')), 4);
    expect(list.doc.toJSON()).toEqual(
      doc(
        p('前'),
        schema.node('bullet_list', null, [
          schema.node('list_item', null, [p('后')]),
        ])
      ).toJSON()
    );
    const quote = typeAt(doc(lines('前', null, '>')), 4);
    expect(quote.doc.toJSON()).toEqual(
      doc(p('前'), schema.node('blockquote', null, [p()])).toJSON()
    );
  });

  test('leaves the line be when no block begins there', () => {
    expect(typeAt(doc(lines('前', null, '(c')), 5, ')').doc.toJSON()).toEqual(
      doc(lines('前', null, '©')).toJSON()
    );
    expect(typeAt(doc(lines('前', null, '后')), 4).doc.toJSON()).toEqual(
      doc(lines('前', null, '后 ')).toJSON()
    );
    const first = doc(lines('##后'));
    expect(lineAfterBreak(stateAt(first, 3), 3, 3, ' ', parse)).toBeNull();
  });

  test('keeps the break when Markdown starts a block no rule makes', () => {
    const state = typeAt(doc(lines('前', null)), 3, '#');
    expect(state.doc.toJSON()).toEqual(doc(lines('前', null, '#')).toJSON());
    expect(state.selection.head).toBe(4);
    let undone: EditorState | null = null;
    undo(state, (tr) => {
      undone = state.apply(tr);
    });
    expect((undone as EditorState | null)?.doc.toJSON()).toEqual(
      doc(lines('前', null)).toJSON()
    );
  });

  test('leaves a soft line break and a heading as they are', () => {
    const soft = schema.node('paragraph', null, [
      schema.text('前'),
      schema.node('hardbreak', { isInline: true }),
      schema.text('##'),
    ]);
    expect(lineAfterBreak(stateAt(doc(soft), 5), 5, 5, ' ', parse)).toBeNull();
    const inHeading = schema.node('heading', { level: 1 }, [
      schema.text('前'),
      schema.node('hardbreak'),
      schema.text('##'),
    ]);
    expect(
      lineAfterBreak(stateAt(doc(inHeading), 5), 5, 5, ' ', parse)
    ).toBeNull();
  });

  test('gives the typed text back on Backspace and the break on undo', () => {
    const typed = typeAt(doc(lines('前', null, '##后')), 5);
    let backspaced: EditorState | null = null;
    undoInputRule(typed, (tr) => {
      backspaced = typed.apply(tr);
    });
    expect((backspaced as EditorState | null)?.doc.toJSON()).toEqual(
      doc(p('前'), p('## 后')).toJSON()
    );
    let undone: EditorState | null = null;
    undo(typed, (tr) => {
      undone = typed.apply(tr);
    });
    expect((undone as EditorState | null)?.doc.toJSON()).toEqual(
      doc(lines('前', null, '##后')).toJSON()
    );
  });
});
