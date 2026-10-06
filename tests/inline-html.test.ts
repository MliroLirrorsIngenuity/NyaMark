import { beforeAll, describe, expect, test } from 'bun:test';
import {
  SerializerReady,
  commands,
  config,
  editorState,
  editorViewCtx,
  init,
  keymap,
  parser,
  parserCtx,
  pasteRule,
  schema,
  serializer,
  serializerCtx,
} from '@milkdown/kit/core';
import { Clock, Container, Ctx } from '@milkdown/kit/ctx';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { inlineHtmlRuns } from '../src/editor/plugins/inline-html';
import {
  markdownOutput,
  writeAsNotes,
} from '../src/editor/plugins/markdown-output';

let open: (markdown: string) => ProseNode;
let save: (markdown: string) => string;

beforeAll(async () => {
  const ctx = new Ctx(new Container(), new Clock());
  ctx.inject(editorViewCtx, {} as never);
  const plugins = [
    config(writeAsNotes),
    init({} as never),
    schema,
    parser,
    serializer,
    commands,
    keymap,
    pasteRule,
    editorState,
    commonmark,
    gfm,
    markdownOutput,
    inlineHtmlRuns,
  ].flat();
  const runners = plugins.map((plugin) => plugin(ctx));
  void Promise.all(runners.map((run) => run()));
  await ctx.wait(SerializerReady);
  const parse = ctx.get(parserCtx);
  const write = ctx.get(serializerCtx);
  open = (markdown) => parse(markdown);
  save = (markdown) => write(parse(markdown));
});

/** The HTML in the document, a node at a time. */
function htmlIn(markdown: string): string[] {
  const values: string[] = [];
  open(markdown).descendants((node) => {
    if (node.type.name === 'html') values.push(node.attrs.value);
  });
  return values;
}

describe('HTML in running text', () => {
  test('takes a citation whole, tags and text', () => {
    const cite =
      '<sup id="cite-rfc1952"><a href="#ref-rfc1952" title="RFC 1952">[5]</a></sup>';
    const markdown = `gzip${cite}→ BNAV v5\n`;
    expect(htmlIn(markdown)).toEqual([cite]);
    expect(save(markdown)).toBe(markdown);
  });

  test('takes the anchor and back link written together', () => {
    const markdown =
      '1. <span id="ref-a"></span><a href="#cite-a" title="回到正文">↑</a> A. Author. [site](https://a.example)\n';
    expect(htmlIn(markdown)).toEqual([
      '<span id="ref-a"></span><a href="#cite-a" title="回到正文">↑</a>',
    ]);
    expect(save(markdown)).toBe(markdown);
  });

  test('keeps elements with words between them apart', () => {
    const markdown =
      'Press <kbd>Ctrl</kbd>+<kbd>C</kbd>, <a href="#a">↑<sup>1</sup></a> <a href="#b">↑<sup>2</sup></a>\n';
    expect(htmlIn(markdown)).toEqual([
      '<kbd>Ctrl</kbd>',
      '<kbd>C</kbd>',
      '<a href="#a">↑<sup>1</sup></a>',
      '<a href="#b">↑<sup>2</sup></a>',
    ]);
    expect(save(markdown)).toBe(markdown);
  });

  test('keeps the Markdown and escapes in a table cell as written', () => {
    const markdown =
      '| a | b                         |\n| - | ------------------------- |\n| x | <sup>**1** \\| [2]</sup> y |\n';
    expect(htmlIn(markdown)).toEqual(['<sup>**1** \\| [2]</sup>']);
    expect(save(markdown)).toBe(markdown);
  });

  test('leaves a tag whose element is not all there', () => {
    expect(htmlIn('a <kbd>b\n')).toEqual(['<kbd>']);
    expect(htmlIn('a </kbd> b <img src="x.png"> c\n')).toEqual([
      '</kbd>',
      '<img src="x.png">',
    ]);
    expect(htmlIn('**<b>x**</b>\n')).toEqual(['<b>', '</b>']);
  });

  test('reads the tags as an HTML parser does', () => {
    for (const [markdown, html] of [
      ['a <span/>b</span> c\n', '<span/>b</span>'],
      ['a <b>x</i>y</b> c\n', '<b>x</i>y</b>'],
      ['a <SUP>1</sup > c\n', '<SUP>1</sup >'],
    ]) {
      expect(htmlIn(markdown)).toEqual([html]);
      expect(save(markdown)).toBe(markdown);
    }
  });

  test('leaves an element written over lines', () => {
    const markdown = '> <span>a\n> b</span>\n';
    expect(htmlIn(markdown)).toEqual(['<span>', '</span>']);
    expect(save(markdown)).toBe(markdown);
  });
});
