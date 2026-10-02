import { describe, expect, test } from 'bun:test';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { markBareLinks, writeLink } from '../src/editor/plugins/bare-links';

type Tree = { type: string; value?: string; children?: Tree[] };

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, { handlers: { link: writeLink } });

/** Parses `markdown` the way the editor does, edits it, and writes it. */
function roundTrip(markdown: string, edit?: (tree: Tree) => void) {
  const tree = processor.parse(markdown) as Tree;
  markBareLinks(tree, markdown);
  edit?.(tree);
  return processor.stringify(tree as never);
}

function find(tree: Tree, type: string): Tree | undefined {
  if (tree.type === type) return tree;
  for (const child of tree.children ?? []) {
    const found = find(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('bare links', () => {
  test('keeps a bare address bare', () => {
    const markdown = '见 https://example.com/a_b 这里。\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('keeps a bare www link and email address bare', () => {
    const markdown = 'www.example.org 和 me@example.com 都行。\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('keeps an email address bare before Chinese punctuation', () => {
    const markdown = '写信到 me@example.com。也可以 you@example.org，谢谢\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('keeps a bare link in a table cell bare', () => {
    const markdown = '| 链接 |\n| - |\n| https://e.com/f |\n';
    expect(roundTrip(markdown)).toContain('| https://e.com/f |');
  });

  test('keeps a bare link before trailing punctuation', () => {
    const markdown = '句末 https://d.com/e.\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('leaves links written another way as they were', () => {
    const markdown = '<https://a.com/y> 和 [文字](https://b.com/z)\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('spells out a bare link whose text was edited', () => {
    const edited = roundTrip('见 https://a.com 这里\n', (tree) => {
      const text = find(find(tree, 'link') as Tree, 'text') as Tree;
      text.value = '首页';
    });
    expect(edited).toBe('见 [首页](https://a.com) 这里\n');
  });

  test('spells out a bare link that text was typed against', () => {
    const typed = roundTrip('见 https://a.com 这里\n', (tree) => {
      const paragraph = find(tree, 'paragraph') as Tree;
      const after = paragraph.children?.[2] as Tree;
      after.value = '这里';
    });
    expect(typed).toBe('见 <https://a.com>这里\n');
  });
});
