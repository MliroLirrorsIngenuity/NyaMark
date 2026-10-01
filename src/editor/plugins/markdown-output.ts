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
 * Alerts: the `[!NOTE]` marker that opens a GFM alert was escaped to
 * `\[!NOTE]`, which GitHub then shows as plain text. It is written verbatim,
 * and a hard break typed after it becomes a plain line break: GitHub does not
 * accept `[!NOTE]\` as a marker line.
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
 * Escapes: remark escapes every `_` in text and every `#` that starts a line,
 * so a saved file had `snake\_case` and `\#tag` in place of what was typed,
 * in every paragraph the file held, and `3 \* 4` for `3 * 4`. An underscore
 * between two letters or digits never opens or closes emphasis, nor does a
 * star or underscore between spaces, and hashes start a heading only when six
 * or fewer are followed by a space: `writeText` leaves those unescaped.
 * remark escaped `&` before any letter as well, `AT\&T` and `?a=1\&b=2` in a
 * link; `writeRoot` escapes it where it would start a character reference.
 *
 * Dollars: remark-math escapes every `$` in text, so `$5` was saved as `\$5`.
 * A paragraph whose dollars all come back as text when the file is opened
 * (see `math-dollars`) has them written as typed. One that has math in it,
 * or two dollars around something that would be read as math, keeps them
 * escaped.
 *
 * Tildes: every `~` was escaped, so a range was saved as `3\~5 天`. One tilde
 * starts no strikethrough, and is written as typed unless another is next to
 * it.
 */

import { $remark } from '@milkdown/kit/utils';
import {
  type ConstructName,
  type Handle,
  defaultHandlers,
} from 'mdast-util-to-markdown';
import type { Processor } from 'unified';
import { isDollarText } from './math-dollars';

type MdNode = {
  type: string;
  value?: string;
  spread?: unknown;
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

function unescapeAlertMarker(blockquote: MdNode) {
  const paragraph = blockquote.children?.[0];
  if (paragraph?.type !== 'paragraph') return;
  const text = paragraph.children?.[0];
  if (text?.type !== 'text' || !text.value) return;
  const marker = text.value.match(ALERT_MARKER)?.[0];
  if (!marker || !paragraph.children) return;
  // An html node is written out as is, so the brackets stay unescaped.
  const rest = text.value.slice(marker.length);
  const hardBreak = !rest && paragraph.children[1]?.type === 'break';
  paragraph.children.splice(
    0,
    hardBreak ? 2 : 1,
    { type: 'html', value: hardBreak ? `${marker}\n` : marker },
    ...(rest ? [{ type: 'text', value: rest }] : [])
  );
}

function trimLeadingSpace(block: MdNode) {
  const first = block.children?.[0];
  if (first?.type !== 'text' || !first.value) return;
  first.value = first.value.replace(
    block.type === 'heading' ? /^[ \t]+/ : /^ (?![ \t])/,
    ''
  );
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

function clearEmptyCell(cell: MdNode) {
  const children = cell.children ?? [];
  if (
    children.every((child) => isEmptyParagraph(child) || isLineBreak(child))
  ) {
    cell.children = [];
  }
}

const INTRAWORD_UNDERSCORE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu;
// A star or underscore with spaces on both sides opens and closes nothing;
// one that starts a line would begin a list item.
const SPACED_MARKER = /(?<=\S[ \t]+)\\([*_])(?=[ \t\n])/g;
const ESCAPED_HASHES = /(^|\n)([ \t]*)\\(#+)(.?)/g;

/** `markdown`, written by remark, without the escapes it needs none of. */
export function relaxEscapes(markdown: string): string {
  return markdown
    .replace(INTRAWORD_UNDERSCORE, '_')
    .replace(SPACED_MARKER, '$1')
    .replace(ESCAPED_HASHES, (escaped, line, indent, hashes, next) =>
      hashes.length > 6 || (next !== '' && !/[ \t]/.test(next))
        ? `${line}${indent}${hashes}${next}`
        : escaped
    );
}

/** Text whose dollars are written as typed (see `markDollarText`). */
const dollarText = new WeakSet<object>();

/**
 * `text`, written by remark, with a tilde unescaped where it stands alone:
 * a strikethrough takes two (see `mark-input`). `before` and `after` are the
 * characters written around it.
 */
export function relaxTildes(text: string, before = '', after = ''): string {
  return text.replace(/\\~/g, (escaped, offset: number) => {
    const previous = offset > 0 ? text[offset - 1] : before;
    const rest = text.slice(offset + 2);
    const next = rest ? rest.replace(/^\\(?=~)/, '')[0] : after;
    return previous === '~' || next === '~' ? escaped : '~';
  });
}

/** Milkdown's handler for text, its escapes relaxed. */
export const writeText: Handle = (node, _parent, state, info) => {
  const value: string = node.value;
  // Milkdown writes text that ends in a space as it is, but for the dollars
  // and tildes that could start math or a strikethrough.
  const text = /^[^*_\\]*\s+$/.test(value)
    ? value.replace(/[$~]/g, '\\$&')
    : relaxEscapes(state.safe(value, { ...info, encode: [] }));
  const relaxed = relaxTildes(text, info.before, info.after);
  return dollarText.has(node) ? relaxed.replace(/\\\$/g, '$') : relaxed;
};

/**
 * `node`'s inline content as a parser sees its dollars: text as it is, and a
 * stand-in for the rest, or null when a dollar outside text is in the way.
 */
function dollarSource(node: MdNode): string | null {
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'break') return '\n';
  if (node.type === 'inlineMath') return null;
  // Code and HTML are written as they are, with any dollar in them.
  if (node.type === 'inlineCode' || node.type === 'html') {
    return node.value?.includes('$') ? null : '`';
  }
  if (!node.children) return '!';
  let source = '';
  for (const child of node.children) {
    const part = dollarSource(child);
    if (part === null) return null;
    source += part;
  }
  // Emphasis, links and the like: their markers are no spaces.
  return `*${source}*`;
}

/** What a parser keeps of the text between two dollars as math. */
function mathValue(between: string) {
  const padded = /^[ \n]/.test(between) && /[ \n]$/.test(between);
  return padded && /[^ \n]/.test(between) ? between.slice(1, -1) : between;
}

/** Whether every dollar in `source`, unescaped, would be read as text. */
export function dollarsStayText(source: string): boolean {
  if (source.includes('$$')) return false;
  let open = source.indexOf('$');
  while (open !== -1) {
    const close = source.indexOf('$', open + 1);
    if (close === -1) return true;
    if (!isDollarText(mathValue(source.slice(open + 1, close)))) return false;
    open = source.indexOf('$', close + 1);
  }
  return true;
}

/** The text of a paragraph, heading or cell, its dollars written as typed. */
function markDollarText(block: MdNode) {
  const source = dollarSource(block);
  if (!source?.includes('$') || !dollarsStayText(source)) return;
  const mark = (node: MdNode) => {
    if (node.type === 'text') dollarText.add(node);
    for (const child of node.children ?? []) mark(child);
  };
  mark(block);
}

// An ampersand starts a character reference only as `&amp;`, `&#38;` or
// `&#x26;`, the semicolon and all.
const REFERENCE_AMPERSAND = {
  character: '&',
  after: '(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);',
  inConstruct: 'phrasing' as ConstructName,
};

/** remark's handler for the whole document, `&` escaped only where needed. */
export const writeRoot: Handle = (node, parent, state, info) => {
  state.unsafe = state.unsafe.map((pattern) =>
    pattern.character === '&' && pattern.after === '[#A-Za-z]'
      ? REFERENCE_AMPERSAND
      : pattern
  );
  return defaultHandlers.root(node, parent, state, info);
};

/** Columns `value` takes in a monospace font. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += WIDE.test(char) ? 2 : 1;
  return width;
}

export function normalizeForOutput<T extends MdNode>(tree: T): T {
  const visit = (node: MdNode) => {
    if (node.type === 'list') normalizeList(node);
    if (node.type === 'blockquote') unescapeAlertMarker(node);
    if (node.type === 'tableCell') clearEmptyCell(node);
    if (node.type === 'paragraph' || node.type === 'heading') {
      trimLeadingSpace(node);
    }
    if (
      node.type === 'paragraph' ||
      node.type === 'heading' ||
      node.type === 'tableCell'
    ) {
      markDollarText(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  // After the trim: a last line of nothing but spaces is empty too.
  const blocks = tree.children;
  while (blocks?.length && isEmptyParagraph(blocks[blocks.length - 1])) {
    blocks.pop();
  }
  return tree;
}

/** Unified plugin: runs `normalizeForOutput` on every tree it stringifies. */
export function normalizeOutput(this: Processor) {
  const compile = this.compiler;
  if (!compile) return;
  this.compiler = (tree, file) =>
    compile(normalizeForOutput(tree as MdNode) as typeof tree, file);
}

export const markdownOutput = $remark(
  'nyamark-markdown-output',
  () => normalizeOutput
);
