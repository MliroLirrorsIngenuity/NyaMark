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
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import { DocStats } from '../src/editor/doc-stats';
import {
  markdownOutput,
  writeAsNotes,
} from '../src/editor/plugins/markdown-output';
import { countLines, countWords } from '../src/editor/text-stats';

let parse: (markdown: string) => Node;
let write: (doc: Node) => string;

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
  const runners = plugins.map((plugin) => plugin(ctx));
  void Promise.all(runners.map((run) => run()));
  await ctx.wait(SerializerReady);
  parse = ctx.get(parserCtx);
  write = ctx.get(serializerCtx);
});

const SOURCES = [
  'Plain text in a paragraph.',
  '# A heading',
  '中文段落，夹着 English words 和 3 个数字。',
  '- one\n- two\n  - nested',
  '1. first\n2. second',
  '- [ ] to do\n- [x] done',
  '- loose\n\n- list',
  '> quoted\n>\n> twice',
  '```js\nconst a = 1;\n\nconst b = 2;\n```',
  '```\n```',
  '| a | b |\n| - | :-: |\n| 1 | 2 |',
  '---',
  'Line one\\\nline two',
  '<div>\nraw\n</div>',
  '![a picture](a.png)',
  '**bold** and *italic* and `code`',
];

function emptyBlocks(): Node[] {
  const { paragraph, hardbreak } = parse('x').type.schema.nodes;
  const { schema } = paragraph;
  return [
    paragraph.create(),
    paragraph.create(null, schema.text('   ')),
    paragraph.create(null, hardbreak.create()),
    paragraph.create(null, [schema.text(' '), hardbreak.create()]),
  ];
}

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

const truth = (doc: Node) => ({
  words: countWords(doc.textBetween(0, doc.content.size, '\n', ' ')),
  lines: countLines(write(doc)),
});

function blocks(doc: Node): Node[] {
  const out: Node[] = [];
  for (let index = 0; index < doc.childCount; index += 1) {
    out.push(doc.child(index));
  }
  return out;
}

describe('document counts', () => {
  test('match the whole document', () => {
    const stats = new DocStats(write);
    const doc = parse(SOURCES.join('\n\n'));
    expect(stats.count(doc)).toEqual(truth(doc));
  });

  test('match a document of empty paragraphs', () => {
    const stats = new DocStats(write);
    const doc = parse('x').copy(Fragment.from(emptyBlocks()));
    expect(stats.count(doc)).toEqual(truth(doc));
  });

  const runs = Number(process.env.FUZZ_RUNS ?? 40);
  const only = process.env.FUZZ_SEED;
  const seeds = only
    ? [Number(only)]
    : Array.from({ length: runs }, (_, i) => i + 1);

  test('follow random edits', () => {
    const pool = SOURCES.map((source) => parse(source).child(0));
    const empty = emptyBlocks();
    for (const seed of seeds) {
      const next = random(seed);
      const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
      const anyBlock = () => (next() < 0.25 ? pick(empty) : pick(pool));
      let doc = parse(
        Array.from({ length: 3 + Math.floor(next() * 12) }, () =>
          pick(SOURCES)
        ).join('\n\n')
      );
      const stats = new DocStats(write);
      for (let step = 0; step < 30; step += 1) {
        const children = blocks(doc);
        const at = Math.floor(next() * (children.length + 1));
        const roll = next();
        if (roll < 0.35) children.splice(at, 0, anyBlock());
        else if (roll < 0.6 && children.length > 1) children.splice(at, 1);
        else if (roll < 0.8) children.splice(at, 1, anyBlock());
        else if (roll < 0.9) children.push(pick(empty));
        else children.splice(at, 0, ...pool.slice(0, 5 + (step % 4) * 30));
        if (children.length === 0) children.push(pick(pool));
        doc = doc.copy(Fragment.from(children));
        if (next() < 0.3) continue;
        const counted = stats.count(doc);
        const expected = truth(doc);
        if (
          counted.lines !== expected.lines ||
          counted.words !== expected.words
        ) {
          throw new Error(
            `seed ${seed}, step ${step}: ${JSON.stringify(counted)} for ${JSON.stringify(expected)}\n${write(doc)}`
          );
        }
      }
    }
  });
});
