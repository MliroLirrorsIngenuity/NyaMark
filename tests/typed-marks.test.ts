import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { AddMarkStep } from '@milkdown/kit/prose/transform';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { strikethroughOptions } from '../src/editor/plugins/cjk-emphasis';
import {
  FLUSH,
  type Parse,
  revertTyped,
  spansOf,
  typedMarksKey,
  typedMarksPlugin,
} from '../src/editor/plugins/typed-marks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true, marks: '' },
    text: { group: 'inline' },
    hardbreak: {
      group: 'inline',
      inline: true,
      attrs: { isInline: { default: false } },
    },
  },
  marks: {
    strong: { attrs: { marker: { default: '*' } } },
    emphasis: { attrs: { marker: { default: '*' } } },
    inlineCode: { code: true },
    strike_through: {},
  },
});

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyStrikethrough, strikethroughOptions);
const parse: Parse = (markdown) => processor.parse(markdown);

const TAGS: Record<string, string> = {
  strong: 'b',
  emphasis: 'i',
  inlineCode: 'code',
  strike_through: 's',
};

function show(state: EditorState) {
  let out = '';
  for (const child of state.doc.firstChild?.content.content ?? []) {
    if (child.type.name === 'hardbreak') {
      out += '<br>';
      continue;
    }
    let text = child.text ?? '';
    for (const mark of [...child.marks].reverse()) {
      const tag = TAGS[mark.type.name];
      text = `<${tag}>${text}</${tag}>`;
    }
    out += text;
  }
  return out;
}

const p = (...parts: (string | Node | null)[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) =>
      part == null
        ? schema.node('hardbreak')
        : typeof part === 'string'
          ? schema.text(part)
          : part
    )
  );

const hardbreakMarks = new Plugin({
  appendTransaction([tr], _old, state) {
    const step = tr?.steps[0];
    if (step instanceof AddMarkStep) {
      state.doc.nodesBetween(step.from, step.to, () => true);
    }
    return null;
  },
});

function open(block: Node, at?: number) {
  const doc = schema.node('doc', null, [block]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, at ?? block.nodeSize - 1),
    plugins: [hardbreakMarks, typedMarksPlugin(parse)],
  });
}

function type(state: EditorState, keys: string) {
  let next = state;
  for (const key of keys) next = next.apply(next.tr.insertText(key));
  return next;
}

const typed = (keys: string) => show(type(open(p()), keys));

function caretTo(state: EditorState, pos: number) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos))
  );
}

describe('typed marks', () => {
  test('turn the marks typed around text into its format', () => {
    expect(typed('一个 *重点*')).toBe('一个 <i>重点</i>');
    expect(typed('要 **粗**')).toBe('要 <b>粗</b>');
    expect(typed('要 __粗__')).toBe('要 <b>粗</b>');
    expect(typed('前文***重点***')).toBe('前文<b><i>重点</i></b>');
    expect(typed('删掉 ~~旧的~~')).toBe('删掉 <s>旧的</s>');
    expect(typed('用 `npm i` 装')).toBe('用 <code>npm i</code> 装');
    expect(typed('a*b*c')).toBe('a<i>b</i>c');
  });

  test('leave what Markdown reads as text', () => {
    for (const text of [
      '3 * 4 * 5',
      '价格_标签_',
      'snake_case_name_',
      '*a *',
      '好的~ 明天见~',
      '3~5 天，100~200 元',
    ]) {
      expect(typed(text)).toBe(text);
    }
  });

  test('read stars beside Chinese punctuation as Typora does', () => {
    expect(typed('这是**“引用”**的')).toBe('这是<b>“引用”</b>的');
    expect(typed('价格**100%**以上')).toBe('价格<b>100%</b>以上');
  });

  test('wait for the rest of a run of stars', () => {
    expect(typed('**粗*')).toBe('**粗*');
    expect(typed('***重点**')).toBe('***重点**');
    expect(typed('``a`b`')).toBe('``a`b`');
    expect(typed('``a`b``')).toBe('<code>a`b</code>');
  });

  test('type on outside the marks after the closing one', () => {
    const state = type(open(p()), '*a*');
    expect(state.storedMarks).toEqual([]);
    expect(show(type(state, 'b'))).toBe('<i>a</i>b');
    expect(typed('`x`y')).toBe('<code>x</code>y');
  });

  test('take text typed between a pair of marks, and go on inside', () => {
    expect(show(type(open(p('前``后'), 3), 'abc'))).toBe(
      '前<code>abc</code>后'
    );
    expect(show(type(open(p('****'), 3), '粗体'))).toBe('<b>粗体</b>');
  });

  test('take an opening mark typed last', () => {
    const state = caretTo(type(open(p()), 'abc`'), 1);
    expect(show(type(state, '`'))).toBe('<code>abc</code>');
    const bold = caretTo(type(open(p()), 'abc**'), 1);
    expect(show(type(bold, '*'))).toBe('*abc**');
    expect(show(type(bold, '**'))).toBe('<b>abc</b>');
  });

  test('take a pair made by deleting', () => {
    const state = open(p('**a **x'), 5);
    const next = state.apply(state.tr.delete(4, 5));
    expect(show(next)).toBe('<b>a</b>x');
  });

  test('leave marks opened as text, typed beside or inside', () => {
    expect(show(type(open(p('`b`')), 'x'))).toBe('`b`x');
    expect(show(type(open(p('`b`'), 3), 'x'))).toBe('`bx`');
    expect(show(type(open(p('*a* b'), 6), '*'))).toBe('*a* b*');
  });

  test('wait for the input method to finish a word', () => {
    const state = open(p('``'), 2);
    const composing = state.apply(
      state.tr.insertText('文本').setMeta('composition', 1)
    );
    expect(show(composing)).toBe('`文本`');
    const done = composing.apply(composing.tr.setMeta(typedMarksKey, FLUSH));
    expect(show(done)).toBe('<code>文本</code>');
  });

  test('come back as text on Backspace right after', () => {
    const state = type(open(p()), '要 *a*');
    expect(show(state)).toBe('要 <i>a</i>');
    const tr = revertTyped(state);
    if (!tr) throw new Error('nothing to revert');
    const back = state.apply(tr);
    expect(show(back)).toBe('要 *a*');
    expect(back.selection.head).toBe(6);
    expect(revertTyped(type(state, 'b'))).toBeNull();
  });

  test('leave code blocks and pastes alone', () => {
    const block = schema.node('code_block', null, schema.text('`a'));
    expect(type(open(block), '`').doc.firstChild?.textContent).toBe('`a`');
    const state = open(p('`a'));
    const pasted = state.apply(
      state.tr.insertText('`').setMeta('uiEvent', 'paste')
    );
    expect(show(pasted)).toBe('`a`');
  });

  test('take marked text inside emphasis, and none inside code', () => {
    const bold = schema.text('b', [schema.marks.strong.create()]);
    const plain = (state: EditorState, key: string) =>
      show(state.apply(state.tr.setStoredMarks([]).insertText(key)));
    expect(plain(open(p('*', bold)), '*')).toBe('<b><i>b</i></b>');
    expect(plain(open(p('`', bold)), '`')).toBe('`<b>b</b>`');
  });

  test('read each line of a paragraph on its own', () => {
    expect(show(type(open(p('a', null)), '*b*'))).toBe('a<br><i>b</i>');
    expect(show(type(open(p('*a', null, 'b')), '*'))).toBe('*a<br>b*');
  });
});

describe('spansOf', () => {
  test('finds each span with its marks and text', () => {
    expect(spansOf('a ` b ` c', parse)).toEqual([
      { mark: 'inlineCode', from: 2, to: 7, textFrom: 4, textTo: 5 },
    ]);
    expect(spansOf('***x***', parse).map((span) => span.mark)).toEqual([
      'strong',
      'emphasis',
    ]);
  });
});
