/**
 * Keeps the markdown NyaMark writes close to what the user wrote. Runs on the
 * mdast tree right before it is stringified; parsing is left alone.
 *
 * Lists: Milkdown 7.20 parses a list's `spread` flag into a string ("false"),
 * and mdast-util-to-markdown only honours a boolean there, so every saved list
 * came back loose -- a blank line between items and before each nested list.
 * An item typed in the editor starts out with `spread: true`, which did the
 * same to every nested list the user typed. The flags are turned back into
 * booleans, and a typed item only stays loose inside a loose list.
 *
 * Alerts: a hard break typed after the `[!NOTE]` marker that opens a GFM
 * alert becomes a plain line break: GitHub does not accept `[!NOTE]\` as a
 * marker line.
 *
 * Trailing empty paragraphs: the editor keeps an empty paragraph after a
 * closing quote, list or code block so the caret has somewhere to go, and
 * leaving a quote with Enter adds another. They were saved as a blank line or
 * a `<br />` at the end of the file. Empty lines at the very end carry nothing
 * in markdown, so they are dropped.
 *
 * Leading spaces: Enter just before a space splits "一 二" into "一" and " 二",
 * and markdown drops the space at the start of a paragraph or heading, so it
 * was written as `&#x20;二` to survive. That one space is left out instead, the
 * way it would read when the file is opened again. Two or more at the start of
 * a paragraph are an indent the user made (Tab inserts four) and keep their
 * entities; a heading has no indent to keep.
 *
 * Empty cells: a cell's text sits in a paragraph, and an emptied one was
 * written as the `<br />` Milkdown keeps for an empty line -- a stray tag in
 * the table for anyone reading the file. An empty GFM cell is left blank.
 *
 * Tables: the pipes of a saved table are lined up by padding each cell, and
 * remark measured a cell by its character count. A Chinese character takes two
 * columns in a monospace editor, so a CJK table came out ragged, with odd
 * gaps after short cells. `displayWidth` counts wide characters as two, the
 * way Prettier does; it goes to remark-gfm as `stringLength`.
 *
 * Blocks in an item of a tight list: remark writes them line after line, and
 * opened again some ran into the next. Text under a table read as another
 * row, text under a quote, a nested list or an HTML block went on in it, and
 * a rule under a line of text made that line a heading. `joinInTightItem`
 * puts a blank line between those two.
 *
 * Bullets: a list right after another takes the other bullet, `*`, so the two
 * stay two lists when the file is opened again. remark carried the bullet of
 * a list into a quote after it, and a list opening the quote was written with
 * `*` too. `forgetBullet` lets go of it at any block after a list but another
 * list.
 */

import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { $remark } from '@milkdown/kit/utils';
import {
  type Handle,
  type Join,
  type State,
  type Unsafe,
  defaultHandlers,
} from 'mdast-util-to-markdown';
import { cjkFriendlyToMarkdown } from 'mdast-util-to-markdown-cjk-friendly';
import type { Processor } from 'unified';
import { noteFollowing, writeLink } from './bare-links';
import { frontMatterOnTop } from './front-matter';

type MdNode = {
  type: string;
  value?: string;
  spread?: unknown;
  /** A list item's task box: `null` when it has none. */
  checked?: boolean | null;
  depth?: number;
  children?: MdNode[];
};

const ALERT_MARKER = /^\[!(?:note|tip|important|warning|caution)\]/i;
const LINE_BREAK = /^<br\s*\/?>$/i;
// East Asian wide and fullwidth ranges: CJK, kana, Hangul, fullwidth forms,
// and the emoji blocks terminals draw two columns wide.
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u;

function normalizeList(list: MdNode) {
  const loose = list.spread === true || list.spread === 'true';
  list.spread = loose;
  for (const item of list.children ?? []) {
    // A parsed item carries the string; a boolean `true` is the schema
    // default of an item typed in the editor.
    item.spread = item.spread === 'true' || (item.spread === true && loose);
  }
}

function plainBreakAfterAlert(blockquote: MdNode) {
  const paragraph = blockquote.children?.[0];
  if (paragraph?.type !== 'paragraph' || !paragraph.children) return;
  const [text, next] = paragraph.children;
  if (text?.type !== 'text' || next?.type !== 'break') return;
  const marker = text.value?.match(ALERT_MARKER)?.[0];
  if (!marker || marker !== text.value) return;
  paragraph.children.splice(0, 2, { type: 'html', value: `${marker}\n` });
}

function trimLeadingSpace(block: MdNode) {
  const first = block.children?.[0];
  if (first?.type !== 'text' || !first.value) return;
  first.value = first.value.replace(
    block.type === 'heading' ? /^[ \t]+/ : /^ (?![ \t])/,
    ''
  );
}

const ATTENTION = new Set(['emphasis', 'strong', 'delete']);

/**
 * Emphasis around nothing. The spaces a mark holds go out of it, so a space
 * typed in italics between plain words left `**` behind, read as text when
 * the file was opened again.
 */
function isEmptyAttention(node: MdNode): boolean {
  return (
    ATTENTION.has(node.type) &&
    (node.children ?? []).every(
      (child) =>
        (child.type === 'text' && !child.value) || isEmptyAttention(child)
    )
  );
}

function dropEmptyAttention(node: MdNode) {
  if (!node.children?.some(isEmptyAttention)) return;
  node.children = node.children.filter((child) => !isEmptyAttention(child));
}

/** Takes the line breaks off the end of `node`; whether nothing is left. */
function trimEndBreaks(node: MdNode): boolean {
  const children = node.children ?? [];
  while (children.length > 0) {
    const last = children[children.length - 1];
    if (
      last.type !== 'break' &&
      !(ATTENTION.has(last.type) && trimEndBreaks(last))
    ) {
      return false;
    }
    children.pop();
  }
  return true;
}

/**
 * Line breaks that end a paragraph carry nothing in markdown. Milkdown
 * leaves out the last one, and one before it was saved as a `\` that came
 * back as text when the file was opened: `甲\`. A paragraph of nothing but
 * line breaks is an empty line, written as Milkdown writes one; it was saved
 * as nothing, and the line was gone.
 */
function endParagraphsPlainly(node: MdNode) {
  if (node.type !== 'paragraph') {
    for (const child of node.children ?? []) endParagraphsPlainly(child);
    return;
  }
  if (trimEndBreaks(node)) node.children = [{ type: 'html', value: '<br />' }];
}

/** Marks whose spaces at either end are written beside them. */
const SPACED = new Set([...ATTENTION, 'link']);

/**
 * The spaces at either end of emphasis or a link go out of it: `** a**`
 * reads as no bold at all. Milkdown moved them out of every piece of text in
 * bold, before the pieces were joined, and `**a `b` c**` was saved as
 * `**a** **`b`** **c**` (see the patch to `@milkdown/transformer`).
 */
function moveEdgeSpaces(node: MdNode) {
  const children = node.children;
  if (!children) return;
  for (const child of children) moveEdgeSpaces(child);
  node.children = joinAlike(children.map(linkInside)).flatMap((child) => {
    if (!SPACED.has(child.type)) return [child];
    const inner = child.children ?? [];
    const first = inner[0];
    const last = inner[inner.length - 1];
    const before = first?.type === 'text' ? edge(first, /^\s+/) : '';
    const after = last?.type === 'text' ? edge(last, /\s+$/) : '';
    return [
      ...(before ? [{ type: 'text', value: before }] : []),
      child,
      ...(after ? [{ type: 'text', value: after }] : []),
    ];
  });
}

/** Takes what `pattern` finds off the text, and gives it. */
function edge(text: MdNode, pattern: RegExp): string {
  const value = text.value ?? '';
  const found = pattern.exec(value);
  if (!found) return '';
  text.value =
    value.slice(0, found.index) + value.slice(found.index + found[0].length);
  return found[0];
}

/**
 * A link all in bold is written in the bold, `**[a](u)**`, as Milkdown wrote
 * it before links went around what is in them.
 */
function linkInside(node: MdNode): MdNode {
  const only = node.children?.length === 1 ? node.children[0] : null;
  if (node.type !== 'link' || !only || !ATTENTION.has(only.type)) return node;
  node.children = only.children;
  only.children = [node];
  return only;
}

/** The node with no children, to tell whether two marks are alike. */
const markOf = ({ children: _, ...mark }: MdNode) => JSON.stringify(mark);

/**
 * `node` with the mark alike to `like` taken out to its outside, from the
 * marks it alone holds: `*` in `**` read as `**` in `*`. Or `node` as it is.
 */
function markOutside(node: MdNode, like: MdNode): MdNode {
  if (!SPACED.has(node.type) || markOf(node) === markOf(like)) return node;
  let parent = node;
  let found = node.children?.length === 1 ? node.children[0] : undefined;
  while (found && markOf(found) !== markOf(like)) {
    if (!SPACED.has(found.type) || found.children?.length !== 1) return node;
    parent = found;
    found = found.children[0];
  }
  if (!found) return node;
  parent.children = found.children;
  found.children = [node];
  return found;
}

/**
 * Bold that runs on past a link all in bold is one bold, `**[a](u)b**`.
 * Milkdown joins the bold before a link to the link's, but wrote the bold
 * after it apart, `**[a](u)****b**`, and the four stars came back as text.
 * Bold in italics after it is taken in the same way, as Milkdown takes it.
 */
function joinAlike(children: MdNode[]): MdNode[] {
  const joined: MdNode[] = [];
  for (const node of children) {
    const last = joined[joined.length - 1];
    const bold = last && ATTENTION.has(last.type) ? last : null;
    const child = bold ? markOutside(node, bold) : node;
    if (bold && markOf(bold) === markOf(child)) {
      bold.children = joinAlike([
        ...(bold.children ?? []),
        ...(child.children ?? []),
      ]);
    } else {
      joined.push(child);
    }
  }
  return joined;
}

const isLineBreak = (node: MdNode) =>
  node.type === 'html' && LINE_BREAK.test(node.value?.trim() ?? '');

/** Empty, or holding only the `<br />` Milkdown writes for an empty line. */
function isEmptyParagraph(node: MdNode) {
  return (
    node.type === 'paragraph' &&
    (node.children ?? []).every(
      (child) => (child.type === 'text' && !child.value) || isLineBreak(child)
    )
  );
}

/**
 * An emptied list item is written as its bare marker, the way it was read:
 * Milkdown's `<br />` for its empty line showed up in an untouched `2.` as
 * soon as anything else changed. A task item keeps it; with no text after
 * `[ ]` the box would read back as plain text.
 *
 * An empty line with more of the item under it goes too, and what follows
 * starts on the marker's line, `- - b`; the editor puts the empty line back
 * when the file is opened. Its `<br />` began an HTML block, which took the
 * list under it in as text.
 */
function clearEmptyItem(item: MdNode) {
  const [line, ...rest] = item.children ?? [];
  if (item.checked == null && line && isEmptyParagraph(line)) {
    item.children = rest;
  }
}

/**
 * Lists on the line under an item's text. A bare marker there starts no
 * item: `-` underlined the text above it as a heading, and `1.` went on as
 * more of it. Their first item keeps its `<br />` when empty.
 */
const underText = new WeakSet<MdNode>();

function markListsUnderText(item: MdNode) {
  if (item.spread) return;
  const children = item.children ?? [];
  for (const [index, child] of children.entries()) {
    if (child.type === 'list' && children[index - 1]?.type === 'paragraph') {
      underText.add(child);
    }
  }
}

function clearEmptyItems(list: MdNode) {
  for (const [index, item] of (list.children ?? []).entries()) {
    const line = item.children?.length === 1 ? item.children[0] : null;
    if (index > 0 || !underText.has(list) || !line) {
      clearEmptyItem(item);
      continue;
    }
    if (isEmptyParagraph(line) && !line.children?.some(isLineBreak)) {
      line.children = [{ type: 'html', value: '<br />' }];
    }
  }
}

function clearEmptyCell(cell: MdNode) {
  const children = cell.children ?? [];
  if (
    children.every((child) => isEmptyParagraph(child) || isLineBreak(child))
  ) {
    cell.children = [];
  }
}

/** Milkdown's handler for text. */
export const writeText: Handle = (node, _parent, state, info) => {
  // The spaces a text ends in are written as they are: remark encodes one
  // at the end of a line as `&#x20;`. Milkdown wrote all of such a text as
  // it was, and a backtick, hash or bracket in it went out unescaped.
  const [, value, spaces] = /^([\s\S]*?)(\s*)$/.exec(
    node.value
  ) as RegExpExecArray;
  const after = spaces[0] ?? info.after;
  return state.safe(value, { ...info, after, encode: [] }) + spaces;
};

/**
 * remark's handler for rules, `***` for one that opens the file: `---` on the
 * first line starts front matter, and the next `---` closed it over every
 * block in between when the file was opened again.
 */
export const writeThematicBreak: Handle = (node, parent, state) =>
  parent?.type === 'root' && parent.children[0] === node
    ? '***'
    : defaultHandlers.thematicBreak(node, parent, state);

const cjkAttention = cjkFriendlyToMarkdown().handlers ?? {};

/** A character `_` holds no emphasis beside: a letter or digit, CJK too. */
const WORD_CHARACTER = /[^\s\p{P}\p{S}]/u;

/**
 * remark-cjk-friendly's handler for emphasis or bold, in the marker it was
 * written or typed with. Milkdown's own put the stars down wherever the mark
 * began and ended, and between a letter and a stop they open or close
 * nothing: `**Note:**text` and `a*(b)*c` came back as text with the stars in
 * it. There the letter outside goes out as a character reference, `&#x74;`,
 * as remark writes it; beside CJK text the stars hold as they are. `_` holds
 * only beside a space or a stop, and `*` stands in for it elsewhere.
 */
function writeAttention(type: 'emphasis' | 'strong') {
  const handle = cjkAttention[type] as Handle;
  const markerOf = (node: { marker?: string }, state: State) =>
    node.marker === '_' || node.marker === '*'
      ? node.marker
      : (state.options[type] ?? '*');
  return Object.assign(
    ((node, parent, state, info) => {
      noteFollowing(node, parent, info.after);
      const option = state.options[type];
      const outside = [info.before.slice(-1), info.after.charAt(0)];
      state.options[type] =
        markerOf(node, state) === '_' &&
        !outside.some((char) => WORD_CHARACTER.test(char))
          ? '_'
          : '*';
      try {
        return handle(node, parent, state, info);
      } finally {
        state.options[type] = option;
      }
    }) satisfies Handle,
    {
      // The marker, for the text before to escape.
      peek: ((node, _parent, state) => markerOf(node, state)) satisfies Handle,
    }
  );
}

export const writeEmphasis = writeAttention('emphasis');
export const writeStrong = writeAttention('strong');

/**
 * A block in a list item that takes in the line written right under it. A
 * footnote's text does too: in a quote, a list item's line after a footnote
 * went into the footnote.
 */
const RUNS_ON = new Set([
  'table',
  'blockquote',
  'list',
  'html',
  'footnoteDefinition',
]);

/** An empty line, as its `<br />`: an HTML block, which runs on as well. */
const isBreakLine = (node: MdNode) =>
  isEmptyParagraph(node) && (node.children ?? []).some(isLineBreak);

/** A blank line between two blocks of a list item that would merge without. */
export const joinInTightItem: Join = (left, right, parent) => {
  if (parent.type !== 'listItem') return undefined;
  if (RUNS_ON.has(left.type) || isBreakLine(left as MdNode)) return 1;
  if (left.type === 'paragraph' && right.type === 'thematicBreak') return 1;
  return undefined;
};

/** The bullet of the last list forgotten at a block after it but a list. */
export const forgetBullet: Join = (_left, right, _parent, state) => {
  if (right.type !== 'list') state.bulletLastUsed = undefined;
  return undefined;
};

/** Columns `value` takes in a monospace font. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += WIDE.test(char) ? 2 : 1;
  return width;
}

export function normalizeForOutput<T extends MdNode>(tree: T): T {
  const visit = (node: MdNode) => {
    dropEmptyAttention(node);
    if (node.type === 'list') {
      normalizeList(node);
      clearEmptyItems(node);
    }
    if (node.type === 'blockquote') plainBreakAfterAlert(node);
    if (node.type === 'tableCell') clearEmptyCell(node);
    if (node.type === 'listItem') markListsUnderText(node);
    if (node.type === 'paragraph' || node.type === 'heading') {
      trimLeadingSpace(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  endParagraphsPlainly(tree);
  moveEdgeSpaces(tree);
  visit(tree);
  frontMatterOnTop(tree);
  // After the trim: a last line of nothing but spaces is empty too.
  const blocks = tree.children;
  while (blocks?.length && isEmptyParagraph(blocks[blocks.length - 1])) {
    blocks.pop();
  }
  return tree;
}

type Read = (markdown: string) => unknown;

const ESCAPE = /\\[!-/:-@[-`{-~]/g;
const SETTLED_KEPT = 20000;

const UNSAFE: Unsafe[] = [
  { character: '$', inConstruct: 'phrasing' },
  { character: ':', before: '\\]', inConstruct: 'phrasing' },
];

function joinTexts(children: MdNode[]): MdNode[] {
  const joined: MdNode[] = [];
  for (const child of children) {
    const last = joined[joined.length - 1];
    if (last?.type === 'text' && child.type === 'text') {
      joined[joined.length - 1] = {
        type: 'text',
        value: `${last.value ?? ''}${child.value ?? ''}`,
      };
    } else {
      joined.push(child);
    }
  }
  return joined;
}

const shapeOf = (tree: unknown) =>
  JSON.stringify(tree, (key, value) => {
    if (key === 'position') return undefined;
    return key === 'children' ? joinTexts(value) : value;
  });

type Frame = (text: string) => string | null;

function frameOf(node: MdNode, parent: MdNode | undefined): Frame | null {
  if (node.type === 'tableCell' || parent?.type === 'tableCell') {
    return (text) => `| ${text} |\n| - |`;
  }
  if (node.type === 'heading') {
    const marks = '#'.repeat(node.depth ?? 1);
    return (text) => (text.includes('\n') ? null : `${marks} ${text}`);
  }
  if (node.type !== 'paragraph') return null;
  const first = parent?.children?.[0] === node;
  if (first && parent?.type === 'listItem') {
    const bullet = parent.checked == null ? '- ' : '- [ ] ';
    return (text) => `${bullet}${text.split('\n').join('\n  ')}`;
  }
  if (first && parent?.type === 'blockquote') {
    return (text) => `> ${text.split('\n').join('\n> ')}`;
  }
  return (text) => text;
}

function fewestEscapes(
  written: string,
  frame: Frame,
  shape: (markdown: string) => string
): string {
  const escapes = Array.from(written.matchAll(ESCAPE), (match) => match.index);
  if (escapes.length === 0) return written;
  const framed = frame(written);
  if (framed === null) return written;
  const expected = shape(framed);
  const same = (text: string) => {
    const candidate = frame(text);
    return candidate !== null && shape(candidate) === expected;
  };
  const without = (text: string, at: number) =>
    text.slice(0, at) + text.slice(at + 1);
  const bare = escapes.reduceRight(without, written);
  if (same(bare)) return bare;
  return escapes.reduceRight((text, at) => {
    const next = without(text, at);
    return same(next) ? next : text;
  }, written);
}

type Settled = {
  plain: Map<string, string>;
  notes: string;
  noted: Map<string, string>;
};

const settled = new WeakMap<Read, Settled>();

function settledFor(read: Read, notes: string): Settled {
  const kept = settled.get(read) ?? {
    plain: new Map(),
    notes,
    noted: new Map(),
  };
  settled.set(read, kept);
  if (kept.notes !== notes) {
    kept.notes = notes;
    kept.noted = new Map();
  }
  return kept;
}

function writeRoot(read: Read): Handle {
  const shape = (markdown: string) => shapeOf(read(markdown));
  return (node, parent, state, info) => {
    const parents = new WeakMap<MdNode, MdNode>();
    const notes: string[] = [];
    const visit = (child: MdNode, above: MdNode) => {
      parents.set(child, above);
      if (child.type === 'definition') {
        notes.push(state.handle(child as never, above as never, state, info));
      } else if (child.type === 'footnoteDefinition') {
        const stub = { ...child, children: [] };
        notes.push(state.handle(stub as never, above as never, state, info));
      } else if (
        child.type === 'html' &&
        above.type === 'paragraph' &&
        above.children?.length === 1 &&
        child.value?.trimStart().startsWith('[')
      ) {
        notes.push(child.value);
      }
      for (const below of child.children ?? []) visit(below, child);
    };
    for (const child of (node as MdNode).children ?? []) {
      visit(child, node as MdNode);
    }
    const noted = notes.join('\n\n');
    const kept = settledFor(read, noted);
    const phrasing = state.containerPhrasing;
    state.containerPhrasing = (container, phrasingInfo) => {
      const written = phrasing.call(state, container, phrasingInfo);
      if (!written.includes('\\')) return written;
      const box = container as MdNode;
      const frame = frameOf(box, parents.get(box));
      const key = frame?.(written);
      if (!frame || key == null) return written;
      const noting = noted !== '' && written.includes('[');
      const results = noting ? kept.noted : kept.plain;
      const known = results.get(key);
      if (known !== undefined) return known;
      const framing: Frame = noting
        ? (text) => {
            const framed = frame(text);
            return framed === null ? null : `${framed}\n\n${noted}`;
          }
        : frame;
      const fewest = fewestEscapes(written, framing, shape);
      if (results.size >= SETTLED_KEPT) results.clear();
      results.set(key, fewest);
      return fewest;
    };
    return defaultHandlers.root(node, parent, state, info);
  };
}

/** Unified plugin: runs `normalizeForOutput` on every tree it stringifies. */
export function normalizeOutput(this: Processor) {
  const read: Read = (markdown) => this.runSync(this.parse(markdown), markdown);
  const data = this.data();
  data.toMarkdownExtensions ??= [];
  data.toMarkdownExtensions.push({
    unsafe: UNSAFE,
    handlers: { root: writeRoot(read) },
  });
  const compile = this.compiler;
  if (!compile) return;
  this.compiler = (tree, file) =>
    compile(normalizeForOutput(tree as MdNode) as typeof tree, file);
}

export const markdownOutput = $remark(
  'nyamark-markdown-output',
  () => normalizeOutput
);

/**
 * `-` bullets and `---` rules, the markers most notes are written with;
 * remark's defaults rewrote every one of them to `*` on save. Text keeps the
 * underscores, hashes and ampersands it needs no escape for, a link written
 * bare stays bare (see bare-links), and italics and bold come back beside the
 * letters around them.
 */
export function writeAsNotes(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    bullet: '-' as const,
    rule: '-' as const,
    handlers: {
      ...options.handlers,
      text: writeText,
      link: writeLink,
      emphasis: writeEmphasis,
      strong: writeStrong,
      thematicBreak: writeThematicBreak,
    },
    // remark asks the last of these first, and stops at an answer.
    join: [...(options.join ?? []), joinInTightItem, forgetBullet],
  }));
}
