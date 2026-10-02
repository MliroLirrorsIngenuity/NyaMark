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

import { $remark } from '@milkdown/kit/utils';
import {
  type ConstructName,
  type Handle,
  type Join,
  type State,
  defaultHandlers,
} from 'mdast-util-to-markdown';
import { cjkFriendlyToMarkdown } from 'mdast-util-to-markdown-cjk-friendly';
import type { Processor } from 'unified';
import { noteFollowing } from './bare-links';
import { frontMatterOnTop } from './front-matter';
import { isDollarText } from './math-dollars';

type MdNode = {
  type: string;
  value?: string;
  spread?: unknown;
  /** A list item's task box: `null` when it has none. */
  checked?: boolean | null;
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

const INTRAWORD_UNDERSCORE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu;
// A star or underscore with spaces on both sides opens and closes nothing;
// one that starts a line would begin a list item.
const SPACED_MARKER = /(?<=\S[ \t]+)\\([*_])(?=[ \t\n])/g;
const ESCAPED_HASHES = /(^|\n)([ \t]*)\\(#+)(.?)/g;
// Equals signs underline the line above as a heading only when the line
// holds nothing else: `==高亮==` at the start of one needs no escape.
const ESCAPED_EQUALS = /(^|\n)([ \t]*)\\(=[^\n]*)/g;

/** `markdown`, written by remark, without the escapes it needs none of. */
export function relaxEscapes(markdown: string): string {
  return markdown
    .replace(INTRAWORD_UNDERSCORE, '_')
    .replace(SPACED_MARKER, '$1')
    .replace(ESCAPED_HASHES, (escaped, line, indent, hashes, next) =>
      hashes.length > 6 || (next !== '' && !/[ \t]/.test(next))
        ? `${line}${indent}${hashes}${next}`
        : escaped
    )
    .replace(ESCAPED_EQUALS, (escaped, line, indent, rest: string) =>
      /[^=\s]/.test(rest) ? `${line}${indent}${rest}` : escaped
    );
}

/**
 * Where the bracket escaped at `open` in written `text` closes, or -1. An
 * escaped closing bracket closes nothing.
 */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      if (text[index + 1] === '[') depth += 1;
      index += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    } else if (char === '[') {
      depth += 1;
    }
  }
  return -1;
}

/**
 * `text`, written by remark, with an opening bracket unescaped where it
 * starts nothing: `[1]`, `a[0]`, `[注]`. Kept escaped are a bracket left
 * open, one that looks like a footnote (`[^`), an alert (`[!`), an image
 * (`![`) or a task box at the start of a line, and one whose closing
 * bracket is followed by `(`, `[` or `:`, in the text or as `after`, the
 * character written next. Milkdown turns reference definitions into inline
 * links as it reads, so no document defines `[1]`.
 */
export function relaxBrackets(text: string, after = ''): string {
  return text.replace(/\\\[/g, (escaped, offset: number) => {
    const close = closingBracket(text, offset);
    if (close < 0) return escaped;
    const next = text.slice(close + 1).replace(/^\\/, '')[0] ?? after;
    if (/^[([:]/.test(next)) return escaped;
    if (/[!^]/.test(text[offset + 2] ?? '') || text[offset - 1] === '!') {
      return escaped;
    }
    const atLineStart = offset === 0 || text[offset - 1] === '\n';
    if (atLineStart && /^\\\[[ xX]\]/.test(text.slice(offset))) return escaped;
    return '[';
  });
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

/**
 * Whether `node` begins with the `:` that makes the footnote mark before it,
 * at the start of a line, read as the footnote's own text: `[^1]: …` took
 * the rest of the paragraph out of it as that footnote.
 */
function followsLineMark(node: MdNode, parent: MdNode | undefined) {
  const children = parent?.type === 'paragraph' ? (parent.children ?? []) : [];
  const index = children.indexOf(node);
  if (index < 1 || !node.value?.startsWith(':')) return false;
  if (children[index - 1].type !== 'footnoteReference') return false;
  const before = children[index - 2];
  return (
    !before ||
    before.type === 'break' ||
    (before.type === 'text' && /\n[ \t]*$/.test(before.value ?? ''))
  );
}

/** Milkdown's handler for text, its escapes relaxed. */
export const writeText: Handle = (node, parent, state, info) => {
  // The spaces a text ends in are written as they are: remark encodes one
  // at the end of a line as `&#x20;`. Milkdown wrote all of such a text as
  // it was, and a backtick, hash or bracket in it went out unescaped.
  const [, value, spaces] = /^([\s\S]*?)(\s*)$/.exec(
    node.value
  ) as RegExpExecArray;
  const after = spaces[0] ?? info.after;
  const text = relaxEscapes(
    state.safe(value, { ...info, after, encode: [] }) + spaces
  );
  // Brackets in a link's own text stay as remark wrote them.
  const bracketed =
    state.stack.includes('label') || state.stack.includes('reference')
      ? text
      : relaxBrackets(text, info.after);
  const relaxed = relaxTildes(bracketed, info.before, info.after);
  const written = dollarText.has(node)
    ? relaxed.replace(/\\\$/g, '$')
    : relaxed;
  return followsLineMark(node, parent) ? `\\${written}` : written;
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
 * remark's handler for the whole document, `&` escaped only where needed.
 *
 * remark-math gives its dollar an `after` of undefined, and remark took the
 * key for a condition on the character after it: a dollar before a bracket,
 * star or other escaped character went out unescaped, and `$[a$` came back
 * as math when the file was opened again.
 */
export const writeRoot: Handle = (node, parent, state, info) => {
  state.unsafe = state.unsafe.map((pattern) => {
    if (pattern.character === '&' && pattern.after === '[#A-Za-z]') {
      return REFERENCE_AMPERSAND;
    }
    if ('after' in pattern && pattern.after === undefined) {
      const { after: _after, ...always } = pattern;
      return always;
    }
    return pattern;
  });
  return defaultHandlers.root(node, parent, state, info);
};

/** A block in a list item that takes in the line written right under it. */
const RUNS_ON = new Set(['table', 'blockquote', 'list', 'html']);

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
    if (node.type === 'blockquote') unescapeAlertMarker(node);
    if (node.type === 'tableCell') clearEmptyCell(node);
    if (node.type === 'listItem') markListsUnderText(node);
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
