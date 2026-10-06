import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { strikethroughOptions } from '../src/editor/plugins/cjk-emphasis';
import {
  normalizeOutput,
  writeText,
} from '../src/editor/plugins/markdown-output';
import { typedMarksPlugin } from '../src/editor/plugins/typed-marks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: { strike_through: {} },
});

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, strikethroughOptions);

/** A `~` typed at the end of a paragraph holding `before`. */
function typeTilde(before: string) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text(before)),
  ]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, before.length + 1),
    plugins: [typedMarksPlugin((markdown) => processor.parse(markdown))],
  });
  return state.apply(state.tr.insertText('~')).doc.toJSON().content[0].content;
}

/** Opened and saved again, with GFM as the editor sets it. */
function roundTrip(markdown: string) {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm, { singleTilde: false })
      .use(remarkStringify, { handlers: { text: writeText } })
      .use(normalizeOutput)
      .processSync(markdown)
  );
}

describe('typed tildes', () => {
  test('strikes out text between two tildes on each side', () => {
    expect(typeTilde('删掉 ~~旧的~')).toEqual([
      { type: 'text', text: '删掉 ' },
      { type: 'text', text: '旧的', marks: [{ type: 'strike_through' }] },
    ]);
  });

  test('leaves single tildes as text', () => {
    for (const before of ['好的~ 明天见', '删掉 ~~旧的', '删掉 ~~ 旧的~']) {
      expect(typeTilde(before)).toEqual([{ type: 'text', text: `${before}~` }]);
    }
  });
});

describe('tildes on save', () => {
  test('writes ranges and single tildes as typed', () => {
    for (const markdown of [
      '需要 3~5 天，费用 100~200 元。\n',
      '好的~ 明天见~\n',
      '真删除 ~~旧~~ 了。\n',
      '先 ~~删~~ 再 3~5 天\n',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  test('keeps the escapes of tildes that would strike text out', () => {
    expect(roundTrip('不是 \\~\\~删除\\~\\~ 线\n')).toBe(
      '不是 \\~~删除~~ 线\n'
    );
  });
});
