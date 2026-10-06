/**
 * The open document as the assistant reads it: Markdown, its lines numbered
 * from 1, read whole or in parts. Everything here works on the text alone,
 * so it is the same whichever mode the editor is in.
 */

import type { Heading as HeadingNode, Nodes, Root } from 'mdast';
import { toString as plainText } from 'mdast-util-to-string';

export type DocumentSnapshot = {
  /** The document as Markdown. */
  text: string;
  /** The selection as offsets into `text`; null when nothing is selected. */
  selection: { from: number; to: number } | null;
};

/** The most lines one read returns. */
export const MAX_READ_LINES = 800;
/** The most characters one read returns, whatever the line count. */
export const MAX_READ_CHARS = 40_000;
/** A longer line is cut short in a read. */
const MAX_LINE_CHARS = 2000;
/** The most lines a search lists. */
const MAX_SEARCH_LINES = 50;
/** A line found by a search is shown this far either side of the match. */
const SEARCH_CONTEXT_CHARS = 150;

export type LineRead = {
  /** The lines, numbered, as the model is given them. */
  text: string;
  /** The first and last line returned; 0 and 0 for an empty document. */
  from: number;
  to: number;
  total: number;
};

export type Heading = { line: number; level: number; text: string };

export type SearchRead = { text: string; count: number };

export type MarkdownTree = (markdown: string) => Root;

/** The document's lines; the newline that ends the last is no line of its own. */
export function documentLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function clip(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  return `${line.slice(0, MAX_LINE_CHARS)}… [${line.length - MAX_LINE_CHARS} more characters on this line]`;
}

function numbered(line: string, number: number, width: number): string {
  return `${String(number).padStart(width)}\t${line}`;
}

/**
 * Lines `first` to `last` (1-based, inclusive), numbered, as many as fit in
 * one read.
 */
function readRange(lines: string[], first: number, last: number): LineRead {
  const total = lines.length;
  const width = String(total).length;
  const out: string[] = [];
  let size = 0;
  let to = first - 1;
  for (let number = first; number <= last; number++) {
    const line = numbered(clip(lines[number - 1] ?? ''), number, width);
    if (out.length > 0 && size + line.length + 1 > MAX_READ_CHARS) break;
    out.push(line);
    size += line.length + 1;
    to = number;
  }
  let text = out.join('\n');
  if (to < last) {
    text += `\n… Stopped at line ${to} to keep the read short; read on with offset ${to + 1}.`;
  } else if (to < total) {
    text += `\n… The document goes on to line ${total}; read on with offset ${to + 1}.`;
  }
  return { text, from: first, to, total };
}

/** Lines from `offset` (1-based), at most `limit` of them. */
export function readLines(
  text: string,
  offset = 1,
  limit = MAX_READ_LINES
): LineRead {
  const lines = documentLines(text);
  if (lines.length === 0) {
    return { text: 'The document is empty.', from: 0, to: 0, total: 0 };
  }
  if (offset > lines.length) {
    throw new Error(
      `The document has ${lines.length} lines; offset ${offset} is past its end.`
    );
  }
  const first = Math.max(1, Math.floor(offset));
  const last = Math.min(
    lines.length,
    first + Math.max(1, Math.min(MAX_READ_LINES, Math.floor(limit))) - 1
  );
  return readRange(lines, first, last);
}

/** Every line, numbered, as short documents are given whole. */
export function numberedText(text: string): string {
  const lines = documentLines(text);
  const width = String(lines.length).length;
  return lines
    .map((line, index) => numbered(clip(line), index + 1, width))
    .join('\n');
}

function headingNodes(root: Root): HeadingNode[] {
  const found: HeadingNode[] = [];
  const walk = (node: Nodes) => {
    if (node.type === 'heading') found.push(node);
    else if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

function headingOf(node: HeadingNode, text: string): Heading {
  const first = node.children[0]?.position?.start.offset;
  const last = node.children[node.children.length - 1]?.position?.end.offset;
  return {
    line: node.position?.start.line ?? 1,
    level: node.depth,
    text: first != null && last != null ? text.slice(first, last) : '',
  };
}

/** The document's headings, as the editor reads them. */
export function headings(text: string, tree: MarkdownTree): Heading[] {
  return headingNodes(tree(text)).map((node) => headingOf(node, text));
}

/** The outline as the model is given it: one heading a line, indented by level. */
export function outlineText(list: Heading[], limit = Number.POSITIVE_INFINITY) {
  if (list.length === 0) return 'The document has no headings.';
  const shown = list
    .slice(0, limit)
    .map(
      (heading) =>
        `${'  '.repeat(heading.level - 1)}${'#'.repeat(heading.level)} ${heading.text} (line ${heading.line})`
    );
  if (list.length > limit) {
    shown.push(`… and ${list.length - limit} more headings.`);
  }
  return shown.join('\n');
}

/** Words as they are compared: one space between them, in lower case. */
function plain(words: string): string {
  return words.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function wordsOf(heading: string, tree: MarkdownTree): string {
  const first = tree(heading).children[0];
  return plain(
    plainText(first?.type === 'heading' ? first : tree(`# ${heading}`))
  );
}

/**
 * The section under a heading, down to the next heading of its level or
 * above. `line` picks one of several headings with the same words.
 */
export function readSection(
  text: string,
  tree: MarkdownTree,
  heading: string,
  line?: number
): LineRead & { heading: Heading } {
  const nodes = headingNodes(tree(text));
  const list = nodes.map((node) => headingOf(node, text));
  let matches: Heading[];
  if (line != null) {
    matches = list.filter((candidate) => candidate.line === line);
  } else {
    const words = nodes.map((node) => plain(plainText(node)));
    const wanted = wordsOf(heading, tree);
    matches = list.filter((_, index) => words[index] === wanted);
    if (matches.length === 0 && wanted) {
      matches = list.filter((_, index) => words[index].includes(wanted));
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `No heading matches "${heading}". The headings are:\n${outlineText(list, 100)}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Several headings match "${heading}"; call again with the line of the one you mean:\n${outlineText(matches)}`
    );
  }
  const found = matches[0];
  const next = list.find(
    (candidate) => candidate.line > found.line && candidate.level <= found.level
  );
  const lines = documentLines(text);
  const last = next ? next.line - 1 : lines.length;
  const read = readRange(lines, found.line, last);
  return { ...read, heading: found };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The lines that hold `query`, numbered, with the count of matches. */
export function searchLines(
  text: string,
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean } = {}
): SearchRead {
  if (!query) throw new Error('The search needs something to look for.');
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? 'gu' : 'giu'
    );
  } catch (error) {
    throw new Error(
      `That is not a valid regular expression: ${(error as Error).message}`
    );
  }
  const lines = documentLines(text);
  const width = String(lines.length).length;
  const shown: string[] = [];
  let count = 0;
  let linesWithMatches = 0;
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(pattern)].filter((m) => m[0] !== '');
    if (matches.length === 0) return;
    count += matches.length;
    linesWithMatches++;
    if (shown.length >= MAX_SEARCH_LINES) return;
    const at = matches[0].index ?? 0;
    let excerpt = line;
    if (line.length > SEARCH_CONTEXT_CHARS * 2 + matches[0][0].length) {
      const from = Math.max(0, at - SEARCH_CONTEXT_CHARS);
      const to = Math.min(
        line.length,
        at + matches[0][0].length + SEARCH_CONTEXT_CHARS
      );
      excerpt = `${from > 0 ? '…' : ''}${line.slice(from, to)}${to < line.length ? '…' : ''}`;
    }
    shown.push(numbered(excerpt, index + 1, width));
  });
  if (count === 0) return { text: `No line holds "${query}".`, count };
  const head =
    count === 1
      ? '1 match:'
      : `${count} matches on ${linesWithMatches} lines${linesWithMatches > MAX_SEARCH_LINES ? `, the first ${MAX_SEARCH_LINES} shown` : ''}:`;
  return { text: `${head}\n${shown.join('\n')}`, count };
}

/** The line (1-based) that offset `offset` of `text` is on. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export type SelectionRead = {
  text: string;
  from: number;
  to: number;
  selected: string;
};

/** The selection: the lines it is on, numbered, and its text exactly. */
export function readSelection(
  snapshot: DocumentSnapshot,
  maxChars = MAX_READ_CHARS
): SelectionRead | null {
  const range = snapshot.selection;
  if (!range || range.from >= range.to) return null;
  const { text } = snapshot;
  const from = lineAt(text, range.from);
  // A selection that ends at the start of a line ends on the line before.
  const endsAtLineStart = range.to > 0 && text[range.to - 1] === '\n';
  const to = Math.max(from, lineAt(text, range.to) - (endsAtLineStart ? 1 : 0));
  let selected = text.slice(range.from, range.to);
  if (selected.length > maxChars) {
    selected = `${selected.slice(0, maxChars)}… [${selected.length - maxChars} more characters selected]`;
  }
  const lines = documentLines(text);
  const read = readRange(lines, from, to);
  return {
    text: `The selection is on lines ${from}–${to}:\n${read.text}\n\nThe selected text exactly:\n<selection>\n${selected}\n</selection>`,
    from,
    to,
    selected,
  };
}
