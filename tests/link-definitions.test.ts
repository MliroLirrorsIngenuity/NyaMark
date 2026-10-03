/**
 * Link reference definitions read and written back by the editor's own
 * pipeline: Milkdown with no view, its presets, and the plugins that shape
 * what it writes.
 */

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

/** Opens `markdown` in the editor and saves it, as the app does. */
let save: (markdown: string) => string;

beforeAll(async () => {
  const ctx = new Ctx(new Container(), new Clock());
  // A paragraph asks the view for the document it ends; with no view, there
  // is none to give.
  ctx.inject(editorViewCtx, {} as never);
  // In the order the editor takes them: its own after Milkdown's.
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

describe('link definitions', () => {
  test('keep one no link uses as written', () => {
    expect(
      save(
        "Text [used][a].\n\n[a]: https://a.example\n[spare]:   <my file.md>   'kept'\n"
      )
    ).toBe(
      "Text [used](https://a.example).\n\n[spare]:   <my file.md>   'kept'\n"
    );
  });

  test('keep a second definition of a label', () => {
    expect(save('[x]\n\n[x]: /first\n[x]: /second\n')).toBe(
      '[x](/first)\n\n[x]: /second\n'
    );
  });

  test('match labels as references do, case and spacing aside', () => {
    expect(save('[Some  Label]\n\n[some label]: /a\n')).toBe(
      '[Some  Label](/a)\n'
    );
  });

  test('write one spread over lines on one line', () => {
    expect(save('> [q]:\n> /a\n> "say \\"hi\\""\n')).toBe(
      '> [q]: /a "say \\"hi\\""\n'
    );
  });
});
