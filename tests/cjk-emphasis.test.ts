import { describe, expect, test } from 'bun:test';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { strikethroughOptions } from '../src/editor/plugins/cjk-emphasis';
import { writeRoot, writeText } from '../src/editor/plugins/markdown-output';

type Tree = { type: string; children?: Tree[] };

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyStrikethrough, strikethroughOptions)
  .use(remarkStringify, { handlers: { root: writeRoot, text: writeText } });

const inline = (markdown: string) =>
  ((processor.parse(markdown) as Tree).children?.[0].children ?? []).map(
    (node) => node.type
  );

describe('cjk emphasis', () => {
  test('reads emphasis beside CJK text with punctuation inside', () => {
    expect(inline('这是**“引用”**的')).toEqual(['text', 'strong', 'text']);
    expect(inline('价格**100%**以上')).toEqual(['text', 'strong', 'text']);
    expect(inline('他说*（注意）*然后')).toEqual(['text', 'emphasis', 'text']);
    expect(inline('这是~~“删除”~~的')).toEqual(['text', 'delete', 'text']);
  });

  test('writes it back as it was', () => {
    const markdown = '这是**“引用”**的，价格**100%**以上，~~“删”~~了\n';
    expect(processor.processSync(markdown).toString()).toBe(markdown);
  });

  test('strikes out between two tildes and leaves one as text', () => {
    expect(inline('3~5 天，100~200 元，中~~删~~文')).toEqual([
      'text',
      'delete',
      'text',
    ]);
  });

  test('reads other text as CommonMark does', () => {
    expect(inline('a**.b**c')).toEqual(['text']);
  });
});
