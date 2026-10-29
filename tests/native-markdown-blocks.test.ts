import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { markdownBlocks } from '../src/features/native/markdown-blocks';

const page = parseHTML('<!doctype html><html><body></body></html>');
const saved = globalThis.document;

beforeAll(() => {
  Object.assign(globalThis, { document: page.document });
});

afterAll(() => {
  if (saved === undefined) Reflect.deleteProperty(globalThis, 'document');
  else Object.assign(globalThis, { document: saved });
});

describe('markdownBlocks', () => {
  test('marks bold and italic runs in a paragraph', () => {
    expect(markdownBlocks('**bold** and *it*')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { text: 'bold', bold: true },
          { text: ' and ' },
          { text: 'it', italic: true },
        ],
      },
    ]);
  });

  test('reads a heading with its level', () => {
    expect(markdownBlocks('# Title')).toEqual([
      { kind: 'heading', level: 1, inlines: [{ text: 'Title' }] },
    ]);
    expect(markdownBlocks('###### Small')[0]).toMatchObject({ level: 6 });
  });

  test('keeps the text and language of a fenced block', () => {
    expect(markdownBlocks('```ts\nconst a = 1;\nlet b = 2;\n```')).toEqual([
      { kind: 'code', language: 'ts', text: 'const a = 1;\nlet b = 2;\n' },
    ]);
    expect(markdownBlocks('```\nplain\n```')).toEqual([
      { kind: 'code', language: '', text: 'plain\n' },
    ]);
  });

  test('nests a list in the item before it', () => {
    expect(markdownBlocks('- a\n  - b')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          {
            checked: null,
            blocks: [
              { kind: 'paragraph', inlines: [{ text: 'a' }] },
              {
                kind: 'list',
                ordered: false,
                start: 1,
                items: [
                  {
                    checked: null,
                    blocks: [{ kind: 'paragraph', inlines: [{ text: 'b' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  test('numbers an ordered list from where it starts', () => {
    expect(markdownBlocks('3. x\n4. y')).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [
          {
            checked: null,
            blocks: [{ kind: 'paragraph', inlines: [{ text: 'x' }] }],
          },
          {
            checked: null,
            blocks: [{ kind: 'paragraph', inlines: [{ text: 'y' }] }],
          },
        ],
      },
    ]);
  });

  test('reports whether a task item is checked', () => {
    const [list] = markdownBlocks('- [x] done\n- [ ] todo\n- plain');
    expect(list).toMatchObject({
      kind: 'list',
      items: [
        {
          checked: true,
          blocks: [{ kind: 'paragraph', inlines: [{ text: 'done' }] }],
        },
        {
          checked: false,
          blocks: [{ kind: 'paragraph', inlines: [{ text: 'todo' }] }],
        },
        { checked: null },
      ],
    });
  });

  test('reads a task item that holds several paragraphs', () => {
    const [list] = markdownBlocks('- [x] first\n\n  second\n- [ ] other');
    expect(list).toMatchObject({
      items: [
        {
          checked: true,
          blocks: [
            { kind: 'paragraph', inlines: [{ text: 'first' }] },
            { kind: 'paragraph', inlines: [{ text: 'second' }] },
          ],
        },
        { checked: false },
      ],
    });
  });

  test('keeps the alignment of each table column', () => {
    expect(
      markdownBlocks(
        '| a | b | c | d |\n| :-- | :-: | --: | - |\n| 1 | 2 | 3 | 4 |'
      )
    ).toEqual([
      {
        kind: 'table',
        align: ['left', 'center', 'right', null],
        head: [
          [{ text: 'a' }],
          [{ text: 'b' }],
          [{ text: 'c' }],
          [{ text: 'd' }],
        ],
        rows: [
          [[{ text: '1' }], [{ text: '2' }], [{ text: '3' }], [{ text: '4' }]],
        ],
      },
    ]);
  });

  test('marks text inside a table cell', () => {
    const [table] = markdownBlocks('| a |\n| - |\n| **x** |');
    expect(table).toMatchObject({ rows: [[[{ text: 'x', bold: true }]]] });
  });

  test('keeps a web link and drops one that leaves the app', () => {
    expect(
      markdownBlocks('[site](https://example.com) [bad](javascript:alert(1))')
    ).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { text: 'site', link: 'https://example.com' },
          { text: ' bad' },
        ],
      },
    ]);
    expect(markdownBlocks('[mail](mailto:a@b.c)')[0]).toMatchObject({
      inlines: [{ text: 'mail', link: 'mailto:a@b.c' }],
    });
  });

  test('keeps the TeX of inline math', () => {
    expect(markdownBlocks('so $x^2$ holds')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { text: 'so ' },
          { text: 'x^2', math: true },
          { text: ' holds' },
        ],
      },
    ]);
  });

  test('keeps the TeX of display math', () => {
    expect(markdownBlocks('$$\n\\frac{a}{b}\n$$')).toEqual([
      { kind: 'math', text: '\\frac{a}{b}' },
    ]);
  });

  test('marks code, strikethrough and nested marks', () => {
    expect(markdownBlocks('`c` ~~gone~~ **a *b* c**')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { text: 'c', code: true },
          { text: ' ' },
          { text: 'gone', strike: true },
          { text: ' ' },
          { text: 'a ', bold: true },
          { text: 'b', bold: true, italic: true },
          { text: ' c', bold: true },
        ],
      },
    ]);
  });

  test('folds a soft break to a space and keeps a hard break', () => {
    expect(markdownBlocks('one\ntwo')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'one two' }] },
    ]);
    expect(markdownBlocks('one  \ntwo')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'one\ntwo' }] },
    ]);
  });

  test('reads a quote inside a quote', () => {
    expect(markdownBlocks('> a\n>\n> > b')).toEqual([
      {
        kind: 'quote',
        blocks: [
          { kind: 'paragraph', inlines: [{ text: 'a' }] },
          {
            kind: 'quote',
            blocks: [{ kind: 'paragraph', inlines: [{ text: 'b' }] }],
          },
        ],
      },
    ]);
  });

  test('reads a rule between paragraphs', () => {
    expect(markdownBlocks('a\n\n---\n\nb').map((block) => block.kind)).toEqual([
      'paragraph',
      'rule',
      'paragraph',
    ]);
  });

  test('shows raw HTML as text', () => {
    expect(markdownBlocks('hi <b>x</b>')).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'hi <b>x</b>' }] },
    ]);
  });

  test('gives nothing for empty Markdown', () => {
    expect(markdownBlocks('')).toEqual([]);
  });

  test('copes with a reply cut off mid-construct', () => {
    expect(markdownBlocks('**bo')).toEqual([
      { kind: 'paragraph', inlines: [{ text: '**bo' }] },
    ]);
    for (const partial of [
      '```js\nconst a = 1',
      '$$\n\\frac{',
      '| a | b |\n| - |',
      '- [',
      '[text](https://exa',
      '> ```\n> code',
      '$\\frac{',
    ]) {
      expect(() => markdownBlocks(partial)).not.toThrow();
    }
    expect(markdownBlocks('```js\nconst a = 1')).toEqual([
      { kind: 'code', language: 'js', text: 'const a = 1\n' },
    ]);
  });

  test('falls back to the Markdown as one paragraph when it cannot be read', () => {
    Reflect.deleteProperty(globalThis, 'document');
    try {
      expect(markdownBlocks('**x**')).toEqual([
        { kind: 'paragraph', inlines: [{ text: '**x**' }] },
      ]);
    } finally {
      Object.assign(globalThis, { document: page.document });
    }
  });
});
