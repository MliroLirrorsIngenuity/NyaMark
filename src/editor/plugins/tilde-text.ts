/**
 * A single tilde is text: `3~5 天`, `好的~ 明天见~`.
 *
 * GFM strikes text out between single tildes as it does between pairs, and
 * Chinese puts the tilde to other use: `3~5 天，100~200 元` opened with
 * "5 天，100" struck out, and typing `好的~ 明天见~` struck out " 明天见".
 * A strikethrough takes two tildes, as in Typora and Obsidian, and one stays
 * text when the file is opened (`singleTilde: false` in `editor`) or typed.
 *
 * Milkdown's rule for typed strikethrough took one tilde or two, and looked
 * for them anywhere before the caret: with a pair of single tildes left in a
 * line, each key typed after them struck out a stretch one character off and
 * ate a letter. It is replaced by one that takes two tildes, closed by the
 * one just typed.
 */

import { strikethroughSchema } from '@milkdown/kit/preset/gfm';
import { markRule } from '@milkdown/kit/prose';
import { $inputRule } from '@milkdown/kit/utils';

/** `~~text~~` closed by the tilde typed, the text not starting or ending on a space. */
export const STRIKETHROUGH = /(?<![\w:/~])~~([^~\s](?:[^~]*[^~\s])?)~~$/;

export const strikethroughInput = $inputRule((ctx) =>
  markRule(STRIKETHROUGH, strikethroughSchema.type(ctx))
);
