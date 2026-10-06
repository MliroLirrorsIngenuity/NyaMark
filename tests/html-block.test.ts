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
  remarkCtx,
  schema,
  serializer,
  serializerCtx,
} from '@milkdown/kit/core';
import { Clock, Container, Ctx } from '@milkdown/kit/ctx';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  cjkEmphasis,
  cjkStrikethrough,
} from '../src/editor/plugins/cjk-emphasis';
import {
  htmlFlowParse,
  htmlReferencesMapped,
  inlineHtml,
  isHtmlBlock,
  keepHtmlBlocks,
} from '../src/editor/plugins/html-block';
import { inlineHtmlRuns } from '../src/editor/plugins/inline-html';
import { linkDefinitions } from '../src/editor/plugins/link-definitions';
import {
  markdownOutput,
  writeAsNotes,
} from '../src/editor/plugins/markdown-output';

let open: (markdown: string) => ProseNode;
let save: (markdown: string) => string;
let show: (value: string) => string;

beforeAll(async () => {
  const ctx = new Ctx(new Container(), new Clock());
  ctx.inject(editorViewCtx, {} as never);
  const plugins = [
    config(writeAsNotes),
    config(keepHtmlBlocks),
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
    cjkEmphasis,
    cjkStrikethrough,
    markdownOutput,
    linkDefinitions,
    htmlFlowParse,
    inlineHtmlRuns,
  ].flat();
  const runners = plugins.map((plugin) => plugin(ctx));
  void Promise.all(runners.map((run) => run()));
  await ctx.wait(SerializerReady);
  const parse = ctx.get(parserCtx);
  const write = ctx.get(serializerCtx);
  open = (markdown) => parse(markdown);
  save = (markdown) => write(parse(markdown));
  const syntax = ctx.get(remarkCtx).freeze().data('micromarkExtensions') ?? [];
  show = (value) => inlineHtml(value, syntax);
});

/** Each piece of HTML in the document, and whether it shows as a block. */
function htmlIn(markdown: string): Array<[string, boolean]> {
  const found: Array<[string, boolean]> = [];
  open(markdown).descendants((node, _pos, parent) => {
    if (node.type.name === 'html' && parent) {
      found.push([node.attrs.value, isHtmlBlock(parent)]);
    }
  });
  return found;
}

describe('an HTML block', () => {
  test('is HTML the file has as a block', () => {
    const markdown =
      '<div align="center">\n  <img src="logo.png">\n</div>\n\n> <details>\n> <summary>a</summary>\n> </details>\n\n- <p>x</p>\n';
    expect(htmlIn(markdown)).toEqual([
      ['<div align="center">\n  <img src="logo.png">\n</div>', true],
      ['<details>\n<summary>a</summary>\n</details>', true],
      ['<p>x</p>', true],
    ]);
    expect(save(markdown)).toBe(markdown);
  });

  test('leaves an element on a line of its own in the line', () => {
    const markdown = '<span style="color:red">**重要**</span>\n';
    expect(htmlIn(markdown)).toEqual([
      ['<span style="color:red">**重要**</span>', false],
    ]);
    expect(save(markdown)).toBe(markdown);
  });

  test('leaves tags among words in the line', () => {
    expect(htmlIn('a <kbd>b</kbd> c\n')).toEqual([['<kbd>b</kbd>', false]]);
  });

  test('holds a definition no link uses, as written', () => {
    const markdown = '[a]: https://a.example\n';
    expect(htmlIn(markdown)).toEqual([['[a]: https://a.example', true]]);
    expect(save(markdown)).toBe(markdown);
  });
});

const moved = (reference: string) =>
  /^[a-z]+:|^#/i.test(reference) ? null : `../notes/${reference}`;

describe('HTML in running text, shown', () => {
  test('reads the Markdown in it as the editor reads it', () => {
    expect(
      show('<span style="color:red">~~旧价~~ 见 https://a.com</span>')
    ).toBe(
      '<span style="color:red"><del>旧价</del> 见 <a href="https://a.com">https://a.com</a></span>'
    );
    expect(show('<span>这是**“引用”**的</span>')).toBe(
      '<span>这是<strong>“引用”</strong>的</span>'
    );
  });

  test('reads a tag that opens a block elsewhere as one in a line', () => {
    expect(show('<div>**x**</div>')).toBe('<div><strong>x</strong></div>');
  });
});

describe('htmlReferencesMapped', () => {
  test('moves the image and link addresses beside the document', () => {
    expect(
      htmlReferencesMapped(
        '<p align="center"><img width="120" src="img/logo.png"></p>',
        moved
      )
    ).toBe(
      '<p align="center"><img width="120" src="../notes/img/logo.png"></p>'
    );
    expect(
      htmlReferencesMapped("<a href='docs/a.md'>A</a> <img src=b.png>", moved)
    ).toBe(`<a href='../notes/docs/a.md'>A</a> <img src="../notes/b.png">`);
  });

  test('leaves web addresses, anchors and other attributes alone', () => {
    const html =
      '<a href="https://example.com" title="src=x.png">x</a><a href="#top">t</a><div data-src="y.png"></div>';
    expect(htmlReferencesMapped(html, moved)).toBe(html);
  });
});
