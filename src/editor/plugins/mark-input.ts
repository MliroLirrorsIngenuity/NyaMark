/**
 * Bold, italic and strikethrough typed in their markdown, read the way the
 * file will read them. Milkdown's rules for them went wrong in five ways:
 *
 * - The rules for `_` and `~` looked for a match anywhere before the caret.
 *   With `_b_` or `~a~` left as text in a line, each key typed after it
 *   marked a stretch a character off and ate the key.
 * - `3 * 4 * 5` made " 4 " italic. Markdown takes no emphasis that starts or
 *   ends on a space, and the file was saved as `3  *4*  5`.
 * - `价格_标签_` made 标签 italic, saved as typed, and opened as plain text:
 *   an underscore between letters starts no emphasis.
 * - Typed in inline code, `*x*` split the code in three around italic text.
 *   Milkdown runs its rules in code; these run through ProseMirror's, which
 *   leaves code alone.
 * - One tilde on each side struck text out, as GFM allows, and Chinese puts
 *   the tilde to other use: typing `好的~ 明天见~` struck out " 明天见", and
 *   `3~5 天，100~200 元` opened with "5 天，100" struck out. Strikethrough
 *   takes two tildes, as in Typora and Obsidian, and one is text, typed or
 *   opened (`singleTilde: false` in `editor`).
 *
 * Each rule here closes on the key being typed and takes no space next to
 * the marks; underscores inside a word stay text. Three stars or underscores
 * on each side make the text bold and italic; with none of Milkdown's rules
 * for them, `***text***` stayed text, saved escaped.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { Attrs } from '@milkdown/kit/prose/model';
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** `***text***` closed by the star typed. */
export const STRONG_EMPHASIS_STARS =
  /(?<!\*)\*\*\*([^*\s](?:[^*]*[^*\s])?)\*\*\*$/;
/** `___text___` closed by the underscore typed, not inside a word. */
export const STRONG_EMPHASIS_UNDERSCORES =
  /(?<![\p{L}\p{N}_])___([^_\s](?:[^_]*[^_\s])?)___$/u;
/** `**text**` closed by the star typed. */
export const STRONG_STARS = /(?<!\*)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/;
/** `__text__` closed by the underscore typed, not inside a word. */
export const STRONG_UNDERSCORES =
  /(?<![\p{L}\p{N}_])__([^_\s](?:[^_]*[^_\s])?)__$/u;
/** `*text*` closed by the star typed. */
export const EMPHASIS_STAR = /(?<!\*)\*([^*\s](?:[^*]*[^*\s])?)\*$/;
/** `_text_` closed by the underscore typed, not inside a word. */
export const EMPHASIS_UNDERSCORE =
  /(?<![\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_$/u;
/** `~~text~~` closed by the tilde typed. */
export const STRIKETHROUGH = /(?<!~)~~([^~\s](?:[^~]*[^~\s])?)~~$/;

/**
 * The handler for the marks `names` typed around text: `match[0]` is the
 * text with its delimiters, the last of which is the key being typed, and
 * `match[1]` the text. The delimiters go and the text takes the marks; what
 * is typed next does not.
 */
export function markText(names: string | readonly string[], attrs?: Attrs) {
  const list = typeof names === 'string' ? [names] : names;
  return (
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number
  ) => {
    const types = list.map((name) => state.schema.marks[name]);
    if (!types.length || types.some((type) => !type)) return null;
    const [whole, text = ''] = match;
    const open = whole.indexOf(text);
    const tr = state.tr
      .delete(start + open + text.length, end)
      .delete(start, start + open);
    for (const type of types) {
      if (type) tr.addMark(start, start + text.length, type.create(attrs));
    }
    // After every mark is in: each step drops the marks stored before it.
    for (const type of types) if (type) tr.removeStoredMark(type);
    return tr;
  };
}

export const CODE_OPENED = /(?<!`)`([^`\ufffc]+)$/;
export const CODE_CLOSE = /^`(?!`)/;
export const STRONG_EMPHASIS_STARS_OPENED =
  /(?<!\*)\*\*\*([^*\s](?:[^*]*[^*\s])?)$/;
export const STRONG_EMPHASIS_STARS_CLOSE = /^\*\*\*(?!\*)/;
export const STRONG_EMPHASIS_UNDERSCORES_OPENED =
  /(?<![\p{L}\p{N}_])___([^_\s](?:[^_]*[^_\s])?)$/u;
export const STRONG_EMPHASIS_UNDERSCORES_CLOSE = /^___(?![\p{L}\p{N}_])/u;
export const STRONG_STARS_OPENED = /(?<!\*)\*\*([^*\s](?:[^*]*[^*\s])?)$/;
export const STRONG_STARS_CLOSE = /^\*\*(?!\*)/;
export const STRONG_UNDERSCORES_OPENED =
  /(?<![\p{L}\p{N}_])__([^_\s](?:[^_]*[^_\s])?)$/u;
export const STRONG_UNDERSCORES_CLOSE = /^__(?![\p{L}\p{N}_])/u;
export const EMPHASIS_STAR_OPENED = /(?<!\*)\*([^*\s](?:[^*]*[^*\s])?)$/;
export const EMPHASIS_STAR_CLOSE = /^\*(?!\*)/;
export const EMPHASIS_UNDERSCORE_OPENED =
  /(?<![\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)$/u;
export const EMPHASIS_UNDERSCORE_CLOSE = /^_(?![\p{L}\p{N}_])/u;
export const STRIKETHROUGH_OPENED = /(?<!~)~~([^~\s](?:[^~]*[^~\s])?)$/;
export const STRIKETHROUGH_CLOSE = /^~~(?!~)/;

const hasCode = (state: EditorState, from: number, to: number) => {
  let code = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code)) code = true;
  });
  return code;
};

export function markBetween(
  names: string | readonly string[],
  close: RegExp,
  attrs?: Attrs
) {
  const list = typeof names === 'string' ? [names] : names;
  return (
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number
  ) => {
    const types = list.map((name) => state.schema.marks[name]);
    if (!types.length || types.some((type) => !type)) return null;
    if (!state.selection.empty || state.selection.from !== end) return null;
    const [whole, text = ''] = match;
    if (!text.trim()) return null;
    const $end = state.doc.resolve(end);
    const after = $end.parent.textBetween(
      $end.parentOffset,
      $end.parent.content.size,
      undefined,
      '\ufffc'
    );
    const closing = close.exec(after)?.[0];
    if (!closing || hasCode(state, end, end + closing.length)) return null;
    const typed = whole.slice(end - start);
    const open = whole.length - text.length;
    const tr = state.tr;
    if (typed) tr.insertText(typed, end);
    const textEnd = end + typed.length;
    tr.delete(textEnd, textEnd + closing.length).delete(start, start + open);
    for (const type of types) {
      if (type) tr.addMark(start, start + text.length, type.create(attrs));
    }
    return tr.setSelection(TextSelection.create(tr.doc, start + text.length));
  };
}

const between = (
  pattern: RegExp,
  close: RegExp,
  names: string | readonly string[],
  attrs?: Attrs
) =>
  new InputRule(pattern, markBetween(names, close, attrs), {
    inCodeMark: false,
    undoable: false,
  });

const rule = (
  pattern: RegExp,
  names: string | readonly string[],
  attrs?: Attrs
) => new InputRule(pattern, markText(names, attrs), { inCodeMark: false });

export const markInput = $prose(() =>
  inputRules({
    rules: [
      rule(STRONG_EMPHASIS_STARS, ['strong', 'emphasis'], { marker: '*' }),
      rule(STRONG_EMPHASIS_UNDERSCORES, ['strong', 'emphasis'], {
        marker: '_',
      }),
      rule(STRONG_STARS, 'strong', { marker: '*' }),
      rule(STRONG_UNDERSCORES, 'strong', { marker: '_' }),
      rule(EMPHASIS_STAR, 'emphasis', { marker: '*' }),
      rule(EMPHASIS_UNDERSCORE, 'emphasis', { marker: '_' }),
      rule(STRIKETHROUGH, 'strike_through'),
      between(CODE_OPENED, CODE_CLOSE, 'inlineCode'),
      between(
        STRONG_EMPHASIS_STARS_OPENED,
        STRONG_EMPHASIS_STARS_CLOSE,
        ['strong', 'emphasis'],
        { marker: '*' }
      ),
      between(
        STRONG_EMPHASIS_UNDERSCORES_OPENED,
        STRONG_EMPHASIS_UNDERSCORES_CLOSE,
        ['strong', 'emphasis'],
        { marker: '_' }
      ),
      between(STRONG_STARS_OPENED, STRONG_STARS_CLOSE, 'strong', {
        marker: '*',
      }),
      between(STRONG_UNDERSCORES_OPENED, STRONG_UNDERSCORES_CLOSE, 'strong', {
        marker: '_',
      }),
      between(EMPHASIS_STAR_OPENED, EMPHASIS_STAR_CLOSE, 'emphasis', {
        marker: '*',
      }),
      between(
        EMPHASIS_UNDERSCORE_OPENED,
        EMPHASIS_UNDERSCORE_CLOSE,
        'emphasis',
        { marker: '_' }
      ),
      between(STRIKETHROUGH_OPENED, STRIKETHROUGH_CLOSE, 'strike_through'),
    ],
  })
);
