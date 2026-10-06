/**
 * `## ` typed at the start of a heading makes it a heading of the second
 * level, as it does a paragraph. Milkdown added the level typed to the
 * heading's own: `## ` in front of a first-level heading gave one of the
 * third, and a heading could not be brought up a level by typing.
 *
 * Seven hashes or more begin no heading in Markdown, and stay text. Milkdown
 * made a heading of the seventh level of them, saved as one of the sixth.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const HEADING_LEVEL = /^(#{1,6})\s$/;

export function typedHeadingLevel(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) {
  const $start = state.doc.resolve(start);
  const heading = $start.parent;
  if (heading.type.name !== 'heading') return null;
  const level = match[1]?.length ?? 1;
  return state.tr
    .delete(start, end)
    .setNodeMarkup($start.before(), undefined, { ...heading.attrs, level });
}

export const NOT_A_HEADING = /^#{7,}\s$/;

/** The space typed after the hashes, and nothing more. */
export function keepHashes(
  state: EditorState,
  match: RegExpMatchArray,
  _start: number,
  end: number
) {
  return state.tr.insertText(match[0].slice(-1), end);
}

export const headingInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(HEADING_LEVEL, typedHeadingLevel),
      new InputRule(NOT_A_HEADING, keepHashes),
    ],
  })
);
