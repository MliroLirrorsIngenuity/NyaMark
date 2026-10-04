import { describe, expect, test } from 'bun:test';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { openingOf } from '../src/editor/open-in-parts';

const reader = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkMath);

/** The top-level blocks remark reads in `markdown`, positions left out. */
const blocks = (markdown: string) =>
  JSON.parse(
    JSON.stringify(reader.parse(markdown).children, (key, value) =>
      key === 'position' ? undefined : value
    )
  ) as unknown[];

/** The definitions brought along after the opening. */
const defined = (block: unknown) =>
  ['definition', 'footnoteDefinition'].includes(
    (block as { type: string }).type
  );

/**
 * The opening reads as the same blocks the whole text starts with, the
 * definitions it brings along aside.
 */
function expectReadAlike(markdown: string, opening: string | null) {
  expect(opening).not.toBeNull();
  if (opening === null) return;
  const first = blocks(opening);
  while (first.length > 0 && defined(first[first.length - 1])) first.pop();
  expect(blocks(markdown).slice(0, first.length)).toEqual(first);
}

/** `count` paragraphs of a hundred characters each, blank lines between. */
const paragraphs = (count: number, from = 0) =>
  Array.from(
    { length: count },
    (_, index) => `${String(from + index).padStart(3, '0')} ${'x'.repeat(95)}`
  ).join('\n\n');

describe('openingOf', () => {
  test('draws a short text at once', () => {
    expect(openingOf(paragraphs(10), 1000)).toBeNull();
  });

  test('opens a long one on its first blocks', () => {
    const markdown = paragraphs(40);
    const opening = openingOf(markdown, 1000);
    expect(opening?.length).toBeGreaterThanOrEqual(1000);
    expect(opening?.length).toBeLessThan(1200);
    expect(markdown.startsWith(opening ?? '-')).toBe(true);
    expectReadAlike(markdown, opening);
  });

  test('passes over fenced code with blank lines in it', () => {
    const code = ['```', '# a comment', '', 'more code', '', '```'];
    const markdown = [
      paragraphs(9),
      '',
      ...Array.from({ length: 5 }, () => code.join('\n'))
        .join('\n\n')
        .split('\n'),
      '',
      paragraphs(30, 9),
    ].join('\n');
    const opening = openingOf(markdown, 1000);
    expect(opening?.trimEnd().endsWith('```')).toBe(true);
    expectReadAlike(markdown, opening);
  });

  test('passes over math and an HTML comment', () => {
    const markdown = [
      paragraphs(9),
      '',
      '$$',
      'x',
      '',
      'y',
      '$$',
      '',
      '<!-- hidden',
      '',
      'still hidden',
      '-->',
      '',
      paragraphs(30, 9),
    ].join('\n');
    const opening = openingOf(markdown, 1000);
    expect(opening?.includes('-->')).toBe(true);
    expectReadAlike(markdown, opening);
  });

  test('ends a list before the opening does', () => {
    const list = Array.from({ length: 30 }, (_, index) => `- item ${index}`);
    const markdown = [
      paragraphs(9),
      '',
      list.join('\n\n'),
      '',
      paragraphs(30, 9),
    ].join('\n');
    const opening = openingOf(markdown, 1000);
    expect(opening?.includes('- item 29')).toBe(true);
    expectReadAlike(markdown, opening);
  });

  test('passes over front matter longer than the opening', () => {
    const yaml = Array.from(
      { length: 60 },
      (_, index) => `key${index}: value\n\n# note`
    );
    const markdown = ['---', ...yaml, '---', '', paragraphs(40)].join('\n');
    const opening = openingOf(markdown, 1000);
    expect(opening?.includes('\n---\n')).toBe(true);
    expectReadAlike(markdown, opening);
  });

  test('reads links and notes defined at the end as the whole text does', () => {
    const markdown = [
      'See [the site][site] and a note[^n].',
      '',
      paragraphs(40),
      '',
      '[site]: https://example.com "Example"',
      '[^n]: The note.',
      '',
    ].join('\n');
    const opening = openingOf(markdown, 1000);
    expect(opening?.length).toBeLessThan(1300);
    expectReadAlike(markdown, opening);
  });

  test('draws at once a text with no block to end on past its opening', () => {
    const markdown = [paragraphs(5), '', '```', 'x\n\n'.repeat(1000)].join(
      '\n'
    );
    expect(openingOf(markdown, 1000)).toBeNull();
  });
});
