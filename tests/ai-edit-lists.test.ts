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
import { type EditEnv, proposeEdit } from '../src/ai/edit/propose';
import { replaceText } from '../src/ai/edit/text-edit';
import {
  markdownOutput,
  writeAsNotes,
} from '../src/editor/plugins/markdown-output';
import { sourceSpans } from '../src/editor/source-caret';

/**
 * Milkdown keeps a list's `spread` as the string the Markdown gave, and its
 * schema took only a boolean there, so a document with a list failed
 * ProseMirror's `check()` and every edit the assistant made to it with it.
 */
let env: EditEnv;

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
  ].flat();
  void Promise.all(plugins.map((plugin) => plugin(ctx)).map((run) => run()));
  await ctx.wait(SerializerReady);
  env = {
    parse: (markdown) => ctx.get(parserCtx)(markdown),
    serialize: (doc) => ctx.get(serializerCtx)(doc),
    blockSpans: (markdown) => sourceSpans(ctx.get(remarkCtx), markdown),
  };
});

const LISTS = [
  '- one\n- two\n',
  '1. one\n2. two\n',
  '- [x] done\n- [ ] to do\n',
  '- one\n\n  more\n- two\n',
];

describe('a document with a list', () => {
  test('is one the editor schema holds', () => {
    for (const list of LISTS) {
      const doc = env.parse(`# Title\n\n${list}`);
      expect(() => doc?.check()).not.toThrow();
    }
  });

  test('takes an edit beside the list', () => {
    for (const list of LISTS) {
      const markdown = `Old words here.\n\n${list}`;
      const doc = env.parse(markdown);
      if (!doc) throw new Error('not parsed');
      const proposed = proposeEdit(env, doc, [], (text) =>
        replaceText(text, 'Old words', 'New words')
      );
      expect(proposed.hunks.length).toBeGreaterThan(0);
      expect(proposed.after).toContain('New words here.');
    }
  });

  test('takes an item put into it', () => {
    const doc = env.parse('- [x] done\n- [ ] to do\n');
    if (!doc) throw new Error('not parsed');
    const proposed = proposeEdit(env, doc, [], (text) =>
      replaceText(text, '- [x] done', '- [x] done\n- [ ] also')
    );
    expect(proposed.after).toBe('- [x] done\n- [ ] also\n- [ ] to do\n');
  });
});
