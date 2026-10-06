import { describe, expect, test } from 'bun:test';
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
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { blockAfterBreak } from '../src/editor/plugins/typed-blocks';

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

function stateAt(start: Node, at: number) {
  return EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
    plugins: [rules],
  });
}

const typeAt = (start: Node, at: number, text = ' ') =>
  blockAfterBreak(stateAt(start, at), at, at, text);

describe('blockAfterBreak', () => {
  test('makes a heading of the line after a break', () => {
    const start = doc(lines('升级）', null, '###解决方法', null, '需要'));
    const tr = typeAt(start, 8);
    expect(tr?.doc.toJSON()).toEqual(
      doc(p('升级）'), heading(3, '解决方法'), p('需要')).toJSON()
    );
    expect(tr?.selection.head).toBe(6);
  });

  test('takes the line to the end of the paragraph', () => {
    const tr = typeAt(doc(lines('前', null, '##后')), 5);
    expect(tr?.doc.toJSON()).toEqual(doc(p('前'), heading(2, '后')).toJSON());
  });

  test('leaves no empty paragraph above a break that starts it', () => {
    const tr = typeAt(doc(lines(null, '#x')), 3);
    expect(tr?.doc.toJSON()).toEqual(doc(heading(1, 'x')).toJSON());
    expect(tr?.selection.head).toBe(1);
  });

  test('makes a list or a quote of the line', () => {
    const list = typeAt(doc(lines('前', null, '-后')), 4);
    expect(list?.doc.toJSON()).toEqual(
      doc(
        p('前'),
        schema.node('bullet_list', null, [
          schema.node('list_item', null, [p('后')]),
        ])
      ).toJSON()
    );
    const quote = typeAt(doc(lines('前', null, '>')), 4);
    expect(quote?.doc.toJSON()).toEqual(
      doc(p('前'), schema.node('blockquote', null, [p()])).toJSON()
    );
  });

  test('leaves the line be when no block begins there', () => {
    expect(typeAt(doc(lines('前', null, '(c')), 5, ')')).toBeNull();
    expect(typeAt(doc(lines('前', null, '后')), 4)).toBeNull();
    expect(typeAt(doc(lines('##后')), 3)).toBeNull();
  });

  test('leaves a soft line break and a heading as they are', () => {
    const soft = schema.node('paragraph', null, [
      schema.text('前'),
      schema.node('hardbreak', { isInline: true }),
      schema.text('##'),
    ]);
    expect(typeAt(doc(soft), 5)).toBeNull();
    const inHeading = schema.node('heading', { level: 1 }, [
      schema.text('前'),
      schema.node('hardbreak'),
      schema.text('##'),
    ]);
    expect(typeAt(doc(inHeading), 5)).toBeNull();
  });

  test('comes back as typed on Backspace', () => {
    const start = doc(lines('前', null, '##后'));
    const state = stateAt(start, 5);
    const tr = blockAfterBreak(state, 5, 5, ' ');
    if (!tr) throw new Error('no heading');
    let undone: Transaction | null = null;
    undoInputRule(state.apply(tr), (next) => {
      undone = next;
    });
    expect((undone as Transaction | null)?.doc.toJSON()).toEqual(
      doc(lines('前', null, '## 后')).toJSON()
    );
  });
});
