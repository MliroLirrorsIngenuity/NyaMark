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
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { canSplit } from '@milkdown/kit/prose/transform';
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

export const HEADING_AFTER_BREAK = /\ufffc(#{1,6})\s$/;

export function headingAfterBreak(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) {
  const { heading } = state.schema.nodes;
  const $start = state.doc.resolve(start);
  const line = $start.parent;
  const br = $start.nodeAfter;
  if (!heading || line.type.name !== 'paragraph') return null;
  if (br?.type.name !== 'hardbreak' || br.attrs.isInline) return null;
  const level = match[1]?.length ?? 1;
  const tr = state.tr.delete(start, end);
  if (!canSplit(tr.doc, start, 1, [{ type: heading, attrs: { level } }])) {
    return null;
  }
  tr.split(start, 1, [{ type: heading, attrs: { level } }]);
  const split = tr.steps.length;
  const contentStart = $start.start();
  let next: number | null = null;
  line.forEach((child, offset) => {
    const pos = contentStart + offset;
    if (next == null && pos >= end && child.type.name === 'hardbreak') {
      next = pos;
    }
  });
  if (next != null) {
    const at = tr.mapping.map(next);
    tr.delete(at, at + 1);
    const rest = [{ type: line.type, attrs: line.attrs }];
    if (canSplit(tr.doc, at, 1, rest)) tr.split(at, 1, rest);
  }
  if (start === contentStart) tr.delete(start - 1, start + 1);
  const caret = tr.mapping.slice(split).map(start + 2);
  return tr.setSelection(TextSelection.create(tr.doc, caret));
}

export const headingInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(HEADING_LEVEL, typedHeadingLevel),
      new InputRule(NOT_A_HEADING, keepHashes),
      new InputRule(HEADING_AFTER_BREAK, headingAfterBreak),
    ],
  })
);
