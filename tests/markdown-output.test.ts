import { describe, expect, test } from 'bun:test';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  displayWidth,
  forgetBullet,
  joinInTightItem,
  normalizeOutput,
  writeEmphasis,
  writeStrong,
  writeText,
  writeThematicBreak,
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

  test.each(['[!TIP]', '[!caution]'])(
    'ends a marker line %s typed with a hard break plainly',
    (marker) => {
      expect(roundTrip(`> ${marker}\\\n> Read this first.\n`)).toBe(
        `> ${marker}\n> Read this first.\n`
      );
    }
  );

  test('keeps the hard break after a kind of alert GitHub has not', () => {
    const markdown = '> [!TODO]\\\n> Read this first.\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test('leaves a marker that starts no alert as text', () => {
    for (const markdown of [
      '> body\n>\n> [!NOTE] later\n',
      '[!NOTE] outside\n',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
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

  test('ends a paragraph without its line breaks', () => {
    // Milkdown has already left out the last line break of each.
    const text = (value: string) => ({ type: 'text', value });
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [text('甲'), { type: 'break' }] },
        { type: 'paragraph', children: [] },
        {
          type: 'paragraph',
          children: [
            { type: 'strong', children: [text('乙'), { type: 'break' }] },
          ],
        },
        { type: 'paragraph', children: [text('丙')] },
      ],
    };
    const processor = unified().use(remarkStringify).use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '甲\n\n<br />\n\n**乙**\n\n丙\n'
    );
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

  // Lists as Milkdown hands them over, an emptied line as its `<br />`.
  const br = () => ({
    type: 'paragraph',
    children: [{ type: 'html', value: '<br />' }],
  });
  const item = (checked: boolean | null, ...children: object[]) => ({
    type: 'listItem',
    checked,
    spread: false,
    children,
  });
  const text = (value: string) => ({
    type: 'paragraph',
    children: [{ type: 'text', value }],
  });
  const list = (ordered: boolean, ...children: object[]) => ({
    type: 'list',
    ordered,
    start: 1,
    spread: false,
    children,
  });

  test('writes an emptied list item as its bare marker', () => {
    const tree = {
      type: 'root',
      children: [
        list(
          false,
          item(null, text('a')),
          item(null, br()),
          item(null, text('c'))
        ),
        list(true, item(null, text('x')), item(null, br())),
        list(false, item(false, br())),
      ],
    };
    const processor = unified()
      .use(remarkGfm)
      .use(remarkStringify, { bullet: '-', join: [forgetBullet] })
      .use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '- a\n-\n- c\n\n1. x\n2.\n\n- [ ] <br />\n'
    );
  });

  test('keeps the line break of an emptied first item under text', () => {
    // A bare `-` there underlined the text as a heading; a bare `1.` went
    // on as more of it.
    const tree = {
      type: 'root',
      children: [
        list(
          false,
          item(
            null,
            text('父项'),
            list(false, item(null, br()), item(null, br()))
          ),
          item(null, text('乙'))
        ),
        list(true, item(null, text('父项'), list(true, item(null, br())))),
        list(
          false,
          item(null, text('父项'), list(false, item(null, text(''))))
        ),
      ],
    };
    const processor = unified()
      .use(remarkGfm)
      .use(remarkStringify, { bullet: '-', join: [forgetBullet] })
      .use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '- 父项\n  - <br />\n  -\n- 乙\n\n1. 父项\n   1. <br />\n\n- 父项\n  - <br />\n'
    );
  });

  test('writes what is under an emptied item on its marker line', () => {
    // Under a `<br />` alone on its line, the rest of the item was read as
    // the HTML block it began.
    const tree = {
      type: 'root',
      children: [
        list(
          false,
          item(null, br(), list(false, item(null, text('子项')))),
          item(null, br(), { type: 'blockquote', children: [text('引')] })
        ),
        list(
          true,
          item(
            null,
            text('父项'),
            list(true, item(null, br(), list(true, item(null, text('孙')))))
          )
        ),
        list(
          false,
          item(
            null,
            br(),
            list(false, item(null, br(), list(false, item(null, br()))))
          )
        ),
      ],
    };
    const processor = unified()
      .use(remarkGfm)
      .use(remarkStringify, { bullet: '-', join: [forgetBullet] })
      .use(normalizeOutput);
    expect(processor.stringify(tree as never)).toBe(
      '- - 子项\n- > 引\n\n1. 父项\n   1. 1. 孙\n\n- - *\n'
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

  test('leaves out emphasis its spaces were moved out of', () => {
    const processor = unified()
      .use(remarkGfm)
      .use(remarkStringify)
      .use(normalizeOutput);
    const empty = (type: string, children: Tree[] = []) => ({
      type,
      children: [{ type: 'text', value: '' }, ...children],
    });
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a' },
            empty('emphasis'),
            { type: 'text', value: ' ' },
            empty('strong', [empty('delete')]),
            { type: 'text', value: 'b' },
          ],
        },
      ],
    };
    expect(processor.stringify(tree as never)).toBe('a b\n');
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

  test('takes an emoji for two columns, and a mark for none', () => {
    for (const emoji of ['🚀', '✅', '❤️', '👍🏽', '🇨🇳', '👨‍👩‍👧', '1️⃣']) {
      expect([emoji, displayWidth(emoji)]).toEqual([emoji, 2]);
    }
    expect(displayWidth('e\u0301')).toBe(1);
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm, { stringLength: displayWidth })
      .use(remarkStringify);
    const table = '| 状态 | 项 |\n| --- | --- |\n| 🚀 | 👨‍👩‍👧 |\n';
    expect(processor.processSync(table).toString()).toBe(
      '| 状态 | 项 |\n| ---- | -- |\n| 🚀   | 👨‍👩‍👧 |\n'
    );
  });
});

describe('joinInTightItem', () => {
  type Shape = { type: string; spread?: unknown; children?: Shape[] };
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', rule: '-', join: [joinInTightItem] });
  const shape = (node: Shape): string =>
    node.type +
    (node.children ? `(${node.children.map(shape).join(',')})` : '');

  /** An item holding `a`, `block` and `after`, written in a tight list. */
  function written(block: string) {
    const tree = processor.parse(`- a\n\n  ${block}\n\n  after\n- b\n`);
    const tighten = (node: Shape) => {
      if ('spread' in node) node.spread = false;
      for (const child of node.children ?? []) tighten(child);
    };
    tighten(tree as Shape);
    const out = processor.stringify(tree as never);
    return { out, same: shape(processor.parse(out)) === shape(tree as Shape) };
  }

  test('keeps what follows a table, a quote, a nested list, HTML or a footnote out of it', () => {
    for (const block of [
      '| x | y |\n  | - | - |\n  | 1 | 2 |',
      '> q',
      '- sub',
      '<div>x</div>',
      '[^n]: A note.',
    ]) {
      expect(written(block).same).toBe(true);
    }
  });

  test('keeps a rule from making the line above it a heading', () => {
    expect(written('---').same).toBe(true);
  });

  test('keeps what follows an empty line out of its `<br />`', () => {
    // As Milkdown hands an empty line over: a paragraph of `<br />`.
    const line = (children: Shape[]) => ({ type: 'paragraph', children });
    const item = (...children: Shape[]) => ({
      type: 'listItem',
      spread: false,
      children,
    });
    const list = (...children: Shape[]) => ({
      type: 'list',
      spread: false,
      children,
    });
    const tree = {
      type: 'root',
      children: [
        list(
          item(
            { type: 'code', value: 'c' } as Shape,
            line([{ type: 'html', value: '<br />' } as Shape]),
            list(item(line([{ type: 'text', value: 'sub' } as Shape])))
          )
        ),
      ],
    };
    const out = processor.stringify(tree as never);
    expect(out).toBe('- ```\n  c\n  ```\n  <br />\n\n  - sub\n');
    expect(shape(processor.parse(out))).toBe(
      'root(list(listItem(code,html,list(listItem(paragraph(text))))))'
    );
  });

  test('leaves code and text line after line', () => {
    expect(written('```\n  c\n  ```').out).toBe(
      '- a\n  ```\n  c\n  ```\n  after\n- b\n'
    );
  });
});

describe('forgetBullet', () => {
  const write = (markdown: string) =>
    unified()
      .use(remarkParse)
      .use(remarkStringify, { bullet: '-', join: [forgetBullet] })
      .processSync(markdown)
      .toString();

  test('keeps the bullet of a list opening a quote after a list', () => {
    const markdown = '- a\n\n> - b\n> - c\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('still tells two lists in a row apart', () => {
    expect(write('- a\n\n* b\n')).toBe('- a\n\n* b\n');
  });
});

describe('writeText', () => {
  const write = (markdown: string) =>
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkStringify, {
        bullet: '-',
        handlers: { text: writeText },
      })
      .use(normalizeOutput)
      .processSync(markdown)
      .toString();

  test('escapes a dollar before another escaped character', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(remarkStringify, { handlers: { text: writeText } })
      .use(normalizeOutput);
    const markdown = '\\$\\[a\\$ 与 \\$\\$\\*b\\$\n';
    const written = processor.processSync(markdown).toString();
    expect(written).toBe('\\$[a\\$ 与 \\$\\$*b$\n');
    expect(JSON.stringify(processor.parse(written))).not.toContain('Math');
  });

  test('keeps a bracket that starts nothing', () => {
    const markdown = '见 [1] 注释，数组 a[0] 和 [a]**b**\n\n[注] 开头\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes a bracket that would start a link, footnote or task', () => {
    for (const markdown of [
      '- \\[x] 任务\n',
      '> - \\[ ] 引用里的任务\n',
      'a \\[b](c) 与 [d][e]\n',
      '\\[d][e] 与 [f]\n\n[e]: https://x.com\n',
      '\\[^1] 与 [^2]\n\n[^1]: 脚注\n',
      '\\[a]: b\n',
    ]) {
      expect(write(markdown)).toBe(markdown);
    }
  });

  test('writes a bracket that starts nothing there as typed', () => {
    for (const [escaped, written] of [
      ['\\[ ] 任务\n', '[ ] 任务\n'],
      ['\\[^1] 脚注\n', '[^1] 脚注\n'],
      ['> \\[!NOTE] 提示\n', '> [!NOTE] 提示\n'],
      ['\\[g][链接](https://x.com)\n', '[g][链接](https://x.com)\n'],
      ['\\[未闭合\n', '[未闭合\n'],
      [
        '[链接里的 \\[1\\]](https://x.com)\n',
        '[链接里的 [1]](https://x.com)\n',
      ],
    ]) {
      expect(write(escaped)).toBe(written);
    }
  });

  test('escapes the colon after a footnote mark that starts a line', () => {
    // `[^1]: ` there took the rest of the paragraph as that footnote.
    const markdown =
      '[^1]\\: 见下\n\n- [^1]\\: 列表里\n\n上一行\\\n[^1]\\: 换行后\n\n上一行\n[^1]\\: 软换行，正文 [^1]: 中间\n\n[^1]: 脚注\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('keeps equals signs that start a line with more on it', () => {
    const markdown = '==高亮== 开头\n第二行\n== 也是\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes equals signs that would underline a heading', () => {
    expect(write('标题\n\\===\n')).toBe('标题\n\\===\n');
  });

  test('keeps underscores inside a word', () => {
    const markdown = 'a_b_c 和 snake_case_name 与 1_000 和 中_文\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes underscores that could start emphasis', () => {
    expect(write('\\_一\\_ 与 a \\_b\n')).toBe('\\_一_ 与 a _b\n');
  });

  test('keeps a star or underscore between spaces', () => {
    const markdown = '3 * 4 * 5 与 a _ b\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes a star that would start a list item', () => {
    expect(write('\\* 不是列表\n')).toBe('\\* 不是列表\n');
  });

  test('keeps ampersands that start no character reference', () => {
    const markdown =
      'AT&T 和 R&D，[查询](https://x.com/?a=1&b=2) 与 <https://x.com/?a&b>\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes an ampersand that would start one', () => {
    const markdown = '写成 \\&amp; 或 \\&#38; 才是字面\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('keeps a hash that starts no heading', () => {
    const markdown = '#标签 文本\n\n####### 七个\n\n- #tag\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes hashes that would start a heading', () => {
    const markdown = '\\# 不是标题\n\n\\###### 也不是\n\n\\#\n';
    expect(write(markdown)).toBe(markdown);
  });

  test('escapes text that ends in a space before code', () => {
    for (const markdown of [
      'a\\` 与 *b* `code`\n',
      '\\# 不是标题 `x`\n',
      '\\- 不是列表 `x`\n',
      '1\\. 不是列表 `x`\n',
      '\\> 不是引用 `x`\n',
      'a \\[b](c) `x`\n',
    ]) {
      expect(write(markdown)).toBe(markdown);
    }
  });
});

describe('writeThematicBreak', () => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkStringify, {
      rule: '-',
      handlers: { thematicBreak: writeThematicBreak },
    });

  test('writes a rule that opens the file so it opens no front matter', () => {
    const markdown = '***\n\n第一段\n\n---\n\n第二段\n';
    const tree = processor.parse(markdown) as Tree;
    expect(tree.children?.map((node) => node.type)).toEqual([
      'thematicBreak',
      'paragraph',
      'thematicBreak',
      'paragraph',
    ]);
    expect(processor.stringify(tree as never)).toBe(markdown);
  });

  test('keeps front matter and the rules after it', () => {
    const markdown = '---\ntitle: a\n---\n\n---\n\n正文\n';
    expect(processor.stringify(processor.parse(markdown))).toBe(markdown);
  });
});

describe('writeEmphasis and writeStrong', () => {
  type Inline = {
    type: string;
    value?: string;
    marker?: string;
    children?: Inline[];
  };
  const text = (value: string): Inline => ({ type: 'text', value });
  const mark = (type: string, marker: string, value: string): Inline => ({
    type,
    marker,
    children: [text(value)],
  });
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCjkFriendly)
    .use(remarkStringify, {
      handlers: {
        text: writeText,
        emphasis: writeEmphasis,
        strong: writeStrong,
      },
    });
  /** A line of `children` written, and what it reads as opened again. */
  function save(...children: Inline[]) {
    const markdown = processor.stringify({
      type: 'root',
      children: [{ type: 'paragraph', children }],
    } as never);
    const shape = (node: Inline): string =>
      node.type === 'text'
        ? (node.value ?? '')
        : `<${node.type}>${(node.children ?? []).map(shape).join('')}</>`;
    const read = processor.parse(markdown) as Inline;
    const line = read.children?.[0]?.children ?? [];
    expect(line.map(shape).join('')).toBe(children.map(shape).join(''));
    return markdown;
  }

  test('holds between a letter and a stop', () => {
    expect(save(mark('strong', '*', 'Note:'), text('text'))).toBe(
      '**Note:**&#x74;ext\n'
    );
    expect(save(text('a'), mark('emphasis', '*', '(b)'), text('c'))).toBe(
      '&#x61;*(b)*&#x63;\n'
    );
    expect(save(text('注'), mark('emphasis', '*', '('), text('1'))).toBe(
      '注*(*&#x31;\n'
    );
  });

  test('writes the stars as they are beside CJK text', () => {
    expect(
      save(text('这是'), mark('strong', '*', '「重点」'), text('内容'))
    ).toBe('这是**「重点」**内容\n');
  });

  test('keeps an underscore beside a space and stars inside a word', () => {
    expect(
      save(text('see '), mark('emphasis', '_', 'word'), text(' now'))
    ).toBe('see _word_ now\n');
    expect(save(mark('emphasis', '_', 'word'), text('s'))).toBe('*word*s\n');
    expect(save(text('中'), mark('strong', '_', '文'), text('字'))).toBe(
      '中**文**字\n'
    );
  });
});
