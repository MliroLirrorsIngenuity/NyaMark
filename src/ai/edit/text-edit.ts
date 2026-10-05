/**
 * The assistant's edits as changes to the document's Markdown: a string
 * replaced, text put in after a line, or the whole text written anew. Each
 * gives the new text and the part of the old one it replaced, or says why
 * it cannot be made.
 */

import { documentLines, lineAt } from '../agent/document-text';

export type EditErrorCode =
  | 'not_found'
  | 'ambiguous'
  | 'restructures_document'
  | 'no_change'
  | 'not_ready'
  | 'invalid';

export class EditError extends Error {
  constructor(
    readonly code: EditErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type TextEdit = {
  /** The text after the edit. */
  next: string;
  /** What of the old text it replaced, from the first change to the last. */
  from: number;
  to: number;
  /** It rewrote the whole text. */
  whole?: boolean;
};

/** The most places a failed edit lists. */
const MAX_LISTED = 10;

function occurrences(text: string, search: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(search); at >= 0; ) {
    found.push(at);
    at = text.indexOf(search, at + search.length);
  }
  return found;
}

/** `text` with the line numbers a read gives taken off, when every line has one. */
function withoutLineNumbers(text: string): string | null {
  const lines = text.split('\n');
  const numbered = /^ *\d+\t/;
  if (!lines.every((line) => line === '' || numbered.test(line))) return null;
  if (!lines.some((line) => numbered.test(line))) return null;
  return lines.map((line) => line.replace(numbered, '')).join('\n');
}

function lineList(text: string, offsets: readonly number[]): string {
  const lines = offsets.slice(0, MAX_LISTED).map((at) => lineAt(text, at));
  const more = offsets.length - lines.length;
  return `line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** Lines that hold the first line of `search`, to say where it may be. */
function nearMisses(text: string, search: string): string {
  const first = search
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 3);
  if (!first) return '';
  const lines = documentLines(text);
  const found: string[] = [];
  const needle = first.toLowerCase();
  for (let i = 0; i < lines.length && found.length < 5; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      found.push(`${i + 1}\t${lines[i].slice(0, 200)}`);
    }
  }
  return found.length
    ? ` Lines with its first line, which may differ in the lines after:\n${found.join('\n')}`
    : '';
}

/** `oldString` replaced with `newString`: once, or wherever it is. */
export function replaceText(
  text: string,
  oldString: string,
  newString: string,
  replaceAll = false
): TextEdit {
  if (oldString === '') {
    throw new EditError(
      'invalid',
      'old_string is empty. Use insert_text to add text, or write_document to write the whole document.'
    );
  }
  let search = oldString;
  let replacement = newString;
  let found = occurrences(text, search);
  if (found.length === 0) {
    // Copied from a read with its line numbers still on.
    const bare = withoutLineNumbers(oldString);
    if (bare != null) {
      search = bare;
      replacement = withoutLineNumbers(newString) ?? newString;
      found = occurrences(text, search);
    }
  }
  if (found.length === 0) {
    throw new EditError(
      'not_found',
      `old_string was not found in the document. It has to match the text exactly, spaces and line breaks too, without the line numbers a read shows.${nearMisses(text, search)}`
    );
  }
  if (found.length > 1 && !replaceAll) {
    throw new EditError(
      'ambiguous',
      `old_string is found ${found.length} times, on ${lineList(text, found)}. Give more of the text around it to pick one, or set replace_all to change them all.`
    );
  }
  if (search === replacement) {
    throw new EditError('no_change', 'old_string and new_string are the same.');
  }
  const next = replaceAll
    ? text.split(search).join(replacement)
    : text.slice(0, found[0]) +
      replacement +
      text.slice(found[0] + search.length);
  return {
    next,
    from: found[0],
    to: found[found.length - 1] + search.length,
  };
}

/**
 * `insert` put in after line `line` (0 puts it first) as blocks of its own:
 * a blank line is added either side where there is none.
 */
export function insertAfterLine(
  text: string,
  line: number,
  insert: string
): TextEdit {
  const lines = documentLines(text);
  if (line < 0 || line > lines.length) {
    throw new EditError(
      'invalid',
      `after_line ${line} is past the end: the document has ${lines.length} lines.`
    );
  }
  if (insert.trim() === '') {
    throw new EditError('no_change', 'text is empty.');
  }
  let at = 0;
  for (let i = 0; i < line; i++) {
    const end = text.indexOf('\n', at);
    at = end < 0 ? text.length : end + 1;
  }
  const before = text.slice(0, at);
  const after = text.slice(at);
  let lead = '';
  // The last line, with no newline of its own.
  if (before !== '' && !before.endsWith('\n')) lead += '\n';
  if (before !== '' && !/^[ \t]*$/.test(lines[line - 1] ?? '')) lead += '\n';
  const blankAfter = after === '' || /^[ \t]*\n/.test(after);
  const body = `${lead}${insert.replace(/^\n+|\n+$/g, '')}${blankAfter ? '\n' : '\n\n'}`;
  return { next: before + body + after, from: at, to: at };
}

/** The whole document written anew. */
export function rewriteText(text: string, next: string): TextEdit {
  if (next === text) {
    throw new EditError('no_change', 'The text is the document as it is.');
  }
  return { next, from: 0, to: text.length, whole: true };
}
