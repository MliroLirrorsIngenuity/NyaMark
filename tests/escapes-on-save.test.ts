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
import { linkDefinitions } from '../src/editor/plugins/link-definitions';
import {
  markdownOutput,
  writeAsNotes,
} from '../src/editor/plugins/markdown-output';

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
    linkDefinitions,
  ].flat();
  const runners = plugins.map((plugin) => plugin(ctx));
  void Promise.all(runners.map((run) => run()));
  await ctx.wait(SerializerReady);
  const parse = ctx.get(parserCtx);
  const write = ctx.get(serializerCtx);
  save = (markdown) => write(parse(markdown));
});

function saved(markdown: string) {
  const once = save(markdown);
  expect(save(once)).toBe(once);
  return once;
}

describe('escapes on save', () => {
  test('keep a bracket a definition in the file would take', () => {
    for (const markdown of [
      '\\[c] 是文字\n\n[c]: https://x.com\n',
      '\\[^1] 不是脚注 [^1]\n\n[^1]: 注\n',
    ]) {
      expect(saved(markdown)).toBe(markdown);
    }
  });

  test('keep what starts a task, closes a heading or splits a cell', () => {
    for (const markdown of [
      '- \\[ ] 不是任务\n- [x] 任务\n',
      '# 标题 \\#\n',
      '| a \\| b | c |\n| ------ | - |\n| d      | e |\n',
    ]) {
      expect(saved(markdown)).toBe(markdown);
    }
  });

  test('drop the ones that change nothing', () => {
    for (const [markdown, written] of [
      [
        '\\[a] 与 \\*b\\* 和 \\_c\\_ 与 a\\_b\n',
        '[a] 与 \\*b* 和 \\_c_ 与 a_b\n',
      ],
      ['> \\[!NOTE]\n> 正文\n', '> [!NOTE]\n> 正文\n'],
      ['- [ ] \\[x] 文本\n', '- [ ] [x] 文本\n'],
      ['AT\\&T 与 \\&amp;\n', 'AT&T 与 \\&amp;\n'],
    ]) {
      expect(saved(markdown)).toBe(written);
    }
  });
});
