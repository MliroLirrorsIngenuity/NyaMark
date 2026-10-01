import { describe, expect, test } from 'bun:test';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  displayWidth,
  normalizeOutput,
  writeText,
} from '../src/editor/plugins/markdown-output';

type Tree = { type: string; spread?: unknown; children?: Tree[] };

/**
 * Round-trips `markdown` the way Milkdown does: list flags come out of the
 * editor as strings, or as the schema default for `typed` items.
 */
function roundTrip(markdown: string, { typed = false } = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', rule: '-' })
    .use(normalizeOutput);
  const tree = processor.parse(markdown) as Tree;
  const visit = (node: Tree) => {
    if (node.type === 'listItem' && typed) node.spread = true;
    else if ('spread' in node) node.spread = `${node.spread}`;
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return processor.stringify(tree as never);
}

describe('normalizeOutput', () => {
  test('keeps a tight list tight', () => {
    const markdown = '- one\n- two\n  - nested\n- [ ] task\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('keeps a loose list loose', () => {
    const markdown = '- one\n\n- two\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('keeps an item with two paragraphs apart from its tight siblings', () => {
    const markdown = '- one\n\n  more\n- two\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('writes a list typed in the editor tight', () => {
    expect(roundTrip('- one\n- two\n  - nested\n', { typed: true })).toBe(
      '- one\n- two\n  - nested\n'
    );
  });

  test('leaves the alert marker unescaped', () => {
    const markdown = '> [!NOTE]\n> Read this first.\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('ends a marker line typed with a hard break plainly', () => {
    expect(roundTrip('> [!TIP]\\\n> Read this first.\n')).toBe(
      '> [!TIP]\n> Read this first.\n'
    );
  });

  test('still escapes brackets elsewhere', () => {
    expect(roundTrip('> body\n>\n> [!NOTE] later\n')).toBe(
      '> body\n>\n> \\[!NOTE] later\n'
    );
    expect(roundTrip('[!NOTE] outside\n')).toBe('\\[!NOTE] outside\n');
  });

  test('drops empty lines at the end of the document', () => {
    // The tree Milkdown hands over: the last empty paragraph has no children,
    // the ones before it hold a `<br />`.
    const br = () => ({
      type: 'paragraph',
      children: [{ type: 'html', value: '<br />' }],
    });
    const tree = {
      type: 'root',
      children: [
        br(),
        { type: 'paragraph', children: [{ type: 'text', value: 'end' }] },
        br(),
        { type: 'paragraph', children: [] },
      ],
    };
    const processor = unified().use(remarkStringify).use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe('<br />\n\nend\n');
  });

  test('leaves out the space a split leaves at the start of a block', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: ' 二' }],
        },
        { type: 'paragraph', children: [{ type: 'text', value: ' world' }] },
        { type: 'paragraph', children: [{ type: 'text', value: '    缩进' }] },
        { type: 'paragraph', children: [{ type: 'text', value: '　全角' }] },
      ],
    };
    const processor = unified().use(remarkStringify).use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '## 二\n\nworld\n\n&#x20;   缩进\n\n　全角\n'
    );
  });

  test('leaves an emptied cell blank', () => {
    // A cell holds a paragraph; an emptied one comes as Milkdown's `<br />`.
    const cell = (...children: object[]) => ({ type: 'tableCell', children });
    const text = (value: string) => ({ type: 'text', value });
    const tree = {
      type: 'root',
      children: [
        {
          type: 'table',
          children: [
            { type: 'tableRow', children: [cell(text('a')), cell(text('b'))] },
            {
              type: 'tableRow',
              children: [
                cell(text('1')),
                cell({
                  type: 'paragraph',
                  children: [{ type: 'html', value: '<br />' }],
                }),
              ],
            },
          ],
        },
      ],
    };
    const processor = unified()
      .use(remarkGfm)
      .use(remarkStringify)
      .use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '| a | b |\n| - | - |\n| 1 |   |\n'
    );
  });

  test('lines up a CJK table by display width', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm, { stringLength: displayWidth })
      .use(remarkStringify);
    const table = '| 名称 | 数量 |\n| --- | --- |\n| 梨 | 7 |\n';
    expect(processor.processSync(table).toString()).toBe(
      '| 名称 | 数量 |\n| ---- | ---- |\n| 梨   | 7    |\n'
    );
    expect(displayWidth('a，b😀')).toBe(6);
  });
});

describe('writeText', () => {
  const write = (markdown: string) =>
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkStringify, { bullet: '-', handlers: { text: writeText } })
      .processSync(markdown)
      .toString();

  test('keeps underscores inside a word', () => {
    const markdown = 'a_b_c 和 snake_case_name 与 1_000 和 中_文\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes underscores that could start emphasis', () => {
    expect(write('\\_一\\_ 与 a \\_b\n')).toBe('\\_一\\_ 与 a \\_b\n');
  });

  test('keeps a star or underscore between spaces', () => {
    const markdown = '3 * 4 * 5 与 a _ b\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes a star that would start a list item', () => {
    expect(write('\\* 不是列表\n')).toBe('\\* 不是列表\n');
  });

  test('keeps a hash that starts no heading', () => {
    const markdown = '#标签 文本\n\n####### 七个\n\n- #tag\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes hashes that would start a heading', () => {
    const markdown = '\\# 不是标题\n\n\\###### 也不是\n\n\\#\n';
    expect(write(markdown)).toBe(markdown);
  });
});
