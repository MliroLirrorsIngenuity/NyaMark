/**
 * Link reference definitions read and written back by the editor's own
 * pipeline: Milkdown with no view, its presets, and the plugins that shape
 * what it writes.
 *
 * Random documents are checked against what plain remark reads in the file
 * before and after the save, never against the plugin's own workings:
 *
 * - Every link and picture goes where it went, with the title it had.
 * - The definitions no link takes are all still definitions, with the same
 *   label, address and title, and no others are.
 * - One written on a single line is still written that way.
 * - All of this holds for a second save too.
 *
 * A failure names its seed; `FUZZ_SEED=<seed>` replays that document alone
 * and `FUZZ_RUNS=<n>` makes more of them.
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
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
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

  test('keep the label of one rewritten as written, escapes and all', () => {
    expect(save('- [X\\*Y]:\n  /a\n')).toBe('- [X\\*Y]: /a\n');
  });

  test('bracket an address that would end early written bare', () => {
    expect(save('> [a]:\n> <a(b>\n')).toBe('> [a]: <a(b>\n');
  });

  test('escape what would be read as a character reference', () => {
    expect(save('- [a]:\n  ?q=&amp;lt; "&amp;amp;"\n')).toBe(
      '- [a]: ?q=\\&lt; "\\&amp;"\n'
    );
  });

  test('let links take the first definition, one in a list too', () => {
    expect(save('- item\n\n  [a]: /first\n\n[a]: /second\n\n[a]\n')).toBe(
      '- item\n\n[a]: /second\n\n[a](/first)\n'
    );
  });

  test('keep text in brackets where a kept definition has its label', () => {
    expect(save('See \\[1\\] here.\n\n[1]: https://x\n')).toBe(
      'See \\[1] here.\n\n[1]: https://x\n'
    );
  });
});

type MdNode = {
  type: string;
  identifier?: string;
  url?: string;
  title?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

const remark = unified().use(remarkParse).use(remarkGfm).freeze();

/** What plain remark finds in `markdown`, by the rules the oracle checks. */
function read(markdown: string) {
  const tree = remark.parse(markdown);
  const nodes: MdNode[] = [];
  const walk = (node: MdNode) => {
    nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree as MdNode);

  const definitions = nodes.filter((node) => node.type === 'definition');
  // The first definition of a label is the one its references take.
  const first = new Map<string, MdNode>();
  for (const node of definitions) {
    if (!first.has(node.identifier ?? ''))
      first.set(node.identifier ?? '', node);
  }
  const taken = new Set<MdNode>();
  const links: string[] = [];
  for (const node of nodes) {
    let target: MdNode | undefined;
    if (node.type === 'link' || node.type === 'image') target = node;
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      target = first.get(node.identifier ?? '');
      if (target) taken.add(target);
    }
    if (!target) continue;
    const kind = node.type.startsWith('image') ? 'picture' : 'link';
    links.push(`${kind} ${target.url} ${JSON.stringify(target.title || '')}`);
  }
  const describe = (node: MdNode) =>
    `[${node.identifier}] ${node.url} ${JSON.stringify(node.title || '')}`;
  const spare = definitions.filter((node) => !taken.has(node));
  return {
    links,
    definitions: definitions.map(describe).sort(),
    spare: spare.map(describe).sort(),
    /** Spare definitions written on one line, as written. */
    oneLiners: spare
      .map((node) =>
        markdown.slice(node.position?.start.offset, node.position?.end.offset)
      )
      .filter((written) => !written.includes('\n')),
  };
}

/** mulberry32: small, seedable, good enough to pick pieces with. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = [
  'a',
  'Foo',
  'some label',
  'Ünï',
  '中文',
  'x*y',
  'x\\*y',
  'x~y',
  '1',
];
const DESTINATIONS = [
  'https://a.example',
  '/p',
  '<./a b.md>',
  '<>',
  'a(b)c',
  'a\\(b',
  '<a(b>',
  '?x=1&amp;y=2',
  '?q=&amp;lt;',
  '中文.md',
  'x\\*y',
  '<x\\>y>',
  'a\\\\b',
  '#frag',
];
const TITLES = [
  '"t"',
  "'t'",
  '(t)',
  '"say \\"hi\\""',
  `'it"s'`,
  '"two\nlines"',
  '(a \\) b)',
  '"back\\\\slash"',
  '"&amp;"',
  '"(paren)"',
];
const WORDS = ['text', 'more words', '中文', 'a_b', '*em*', 'x [y'];

/** Random markdown made of definitions, references and the blocks around them. */
function generate(seed: number): string {
  const next = random(seed);
  const below = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]) => items[below(items.length)];
  const chance = (percent: number) => next() * 100 < percent;

  // The same label as another place may write it: other case, other spacing.
  const label = () => {
    const base = pick(LABELS);
    switch (below(5)) {
      case 0:
        return base.toUpperCase();
      case 1:
        return base.replace(/ /g, '  ');
      case 2:
        return base.replace(/ /g, '\n');
      default:
        return base;
    }
  };
  const space = () => pick([' ', ' ', '   ', '\n', ' \n  ']);
  const definition = () => {
    let written = `${' '.repeat(below(4))}[${label()}]:${space()}${pick(DESTINATIONS)}`;
    if (chance(60)) written += `${space()}${pick(TITLES)}`;
    return written;
  };
  const piece = () => {
    switch (below(10)) {
      case 0:
        return `[${pick(WORDS)}][${label()}]`;
      case 1:
        return `[${label()}][]`;
      case 2:
        return `[${label()}]`;
      case 3:
        return `![alt][${label()}]`;
      case 4:
        return `[t](/u${chance(50) ? ' "inline"' : ''})`;
      case 5:
        return chance(50) ? `\\[${label()}\\]` : `\\[${label()}]`;
      case 6:
        return `\`[${pick(LABELS)}]\``;
      case 7:
        return '[^n]';
      default:
        return pick(WORDS);
    }
  };
  const inline = () =>
    Array.from({ length: 1 + below(4) }, piece).join(pick([' ', ' ', '\n']));

  const blocks = (depth: number): string =>
    Array.from({ length: 1 + below(depth === 0 ? 6 : 3) }, () =>
      block(depth)
    ).join(pick(['\n\n', '\n\n', '\n']));
  const block = (depth: number): string => {
    switch (below(depth < 2 ? 10 : 7)) {
      case 0:
      case 1:
      case 2:
        return definition();
      case 3:
      case 4:
        return inline();
      case 5:
        return `# ${inline().replace(/\n/g, ' ')}`;
      case 6:
        return chance(50) ? '```\n[a]: /in-code\n```' : '[^n]: A note.';
      case 7:
        return blocks(depth + 1)
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
      default: {
        const items = Array.from({ length: 1 + below(3) }, () =>
          blocks(depth + 1)
            .split('\n')
            .map((line, index) =>
              index === 0 ? `- ${line}` : line ? `  ${line}` : ''
            )
            .join('\n')
        );
        return items.join(chance(50) ? '\n' : '\n\n');
      }
    }
  };
  return `${blocks(0)}\n`;
}

/** What went wrong with saving `markdown`, if anything. */
function check(markdown: string, again = true): string[] {
  const problems: string[] = [];
  const before = read(markdown);
  let saved: string;
  try {
    saved = save(markdown);
  } catch (error) {
    return [`threw ${error}`];
  }
  const after = read(saved);
  if (JSON.stringify(after.links) !== JSON.stringify(before.links)) {
    problems.push(
      `links ${JSON.stringify(before.links)} became ${JSON.stringify(after.links)}`
    );
  }
  if (JSON.stringify(after.definitions) !== JSON.stringify(before.spare)) {
    problems.push(
      `spare definitions ${JSON.stringify(before.spare)} became ${JSON.stringify(after.definitions)}`
    );
  }
  for (const written of before.oneLiners) {
    if (!saved.includes(written)) problems.push(`${written} was rewritten`);
  }
  if (problems.length === 0 && again) {
    for (const problem of check(saved, false)) {
      problems.push(`saved again, ${problem}`);
    }
  }
  if (problems.length > 0) problems.push(`saved ${JSON.stringify(saved)}`);
  return problems;
}

const RUNS = Number(process.env.FUZZ_RUNS ?? 200);

test('random documents keep their links and spare definitions', () => {
  const seeds = process.env.FUZZ_SEED
    ? [Number(process.env.FUZZ_SEED)]
    : Array.from({ length: RUNS }, (_, index) => index + 1);
  const failures: string[] = [];
  for (const seed of seeds) {
    const markdown = generate(seed);
    const problems = check(markdown);
    if (problems.length > 0) {
      failures.push(
        `seed ${seed}: ${JSON.stringify(markdown)}\n  ${problems.join('\n  ')}`
      );
      if (failures.length >= 5) break;
    }
  }
  expect(failures).toEqual([]);
}, 60_000);
