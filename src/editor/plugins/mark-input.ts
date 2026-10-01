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
 * the marks; underscores inside a word stay text.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { Attrs } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

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
 * The handler for the mark `name` typed around text: `match[0]` is the text
 * with its delimiters, the last of which is the key being typed, and
 * `match[1]` the text. The delimiters go and the text takes the mark; what
 * is typed next does not.
 */
export function markText(name: string, attrs?: Attrs) {
  return (
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number
  ) => {
    const type = state.schema.marks[name];
    if (!type) return null;
    const [whole, text = ''] = match;
    const open = whole.indexOf(text);
    return state.tr
      .delete(start + open + text.length, end)
      .delete(start, start + open)
      .addMark(start, start + text.length, type.create(attrs))
      .removeStoredMark(type);
  };
}

const rule = (pattern: RegExp, name: string, attrs?: Attrs) =>
  new InputRule(pattern, markText(name, attrs), { inCodeMark: false });

export const markInput = $prose(() =>
  inputRules({
    rules: [
      rule(STRONG_STARS, 'strong', { marker: '*' }),
      rule(STRONG_UNDERSCORES, 'strong', { marker: '_' }),
      rule(EMPHASIS_STAR, 'emphasis', { marker: '*' }),
      rule(EMPHASIS_UNDERSCORE, 'emphasis', { marker: '_' }),
      rule(STRIKETHROUGH, 'strike_through'),
    ],
  })
);
