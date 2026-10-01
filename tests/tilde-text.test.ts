import { describe, expect, test } from 'bun:test';
import { markRule } from '@milkdown/kit/prose';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  normalizeOutput,
  relaxTildes,
  writeText,
} from '../src/editor/plugins/markdown-output';
import { STRIKETHROUGH } from '../src/editor/plugins/tilde-text';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: { strike_through: {} },
});

/** A `~` typed at the end of a paragraph holding `before`, struck out or not. */
function typeTilde(before: string) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text(before)),
  ]);
  const end = before.length + 1;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const match = `${before}~`.match(STRIKETHROUGH);
  if (!match) return null;
  const rule = markRule(STRIKETHROUGH, schema.marks.strike_through);
  // biome-ignore lint/suspicious/noExplicitAny: the handler is internal to InputRule
  const handler = (rule as any).handler;
  const tr = handler(state, match, end - (match[0].length - 1), end);
  return tr?.doc.toJSON().content[0].content;
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

describe('STRIKETHROUGH', () => {
  test('strikes out text between two tildes on each side', () => {
    expect(typeTilde('删掉 ~~旧的~')).toEqual([
      { type: 'text', text: '删掉 ' },
      { type: 'text', text: '旧的', marks: [{ type: 'strike_through' }] },
    ]);
  });

  test('leaves single tildes as text', () => {
    expect(typeTilde('好的~ 明天见')).toBeNull();
    expect(typeTilde('删掉 ~~旧的')).toBeNull();
    expect(typeTilde('删掉 ~~ 旧的~')).toBeNull();
  });
});

describe('relaxTildes', () => {
  test('unescapes a tilde on its own', () => {
    expect(relaxTildes('3\\~5 天')).toBe('3~5 天');
  });

  test('keeps the escapes of tildes next to one another', () => {
    expect(relaxTildes('a\\~\\~b')).toBe('a\\~\\~b');
    expect(relaxTildes('\\~a', '~')).toBe('\\~a');
    expect(relaxTildes('a\\~', '', '~')).toBe('a\\~');
  });

  test('tells an escaped backslash from an escape', () => {
    expect(relaxTildes('a\\\\\\~b')).toBe('a\\\\~b');
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
      '不是 \\~\\~删除\\~\\~ 线\n'
    );
  });
});
