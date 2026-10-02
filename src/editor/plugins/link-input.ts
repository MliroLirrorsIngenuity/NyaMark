/**
 * `[text](url)` typed into a line becomes a link once its closing parenthesis
 * is typed, and `![alt](src)` an image. Milkdown has no rule for either: the
 * brackets stayed text and were saved escaped, `\[text]\(url)`.
 *
 * An image typed on a line of its own becomes an image block, the way one
 * opens from a file, with the caret on the line below it; within text it is
 * an inline image. Backspace right after either turns it back into the text
 * typed, as it does after the other shortcuts. Inside a code span still being
 * typed, `` `[a](b)` ``, the brackets stay text for the code.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { caretBelowTypedBlock } from './typed-block-enter';

/** `](url)` or `](url "title")` at the end of the text typed so far. */
const TARGET = String.raw`\]\(([^()\s]+)(?:\s+"([^"]*)")?\)$`;
export const IMAGE = new RegExp(String.raw`!\[([^[\]]*)${TARGET}`);
// Not after `!`, an image's, or `\`, which keeps the bracket text.
export const LINK = new RegExp(String.raw`(^|[^!\\])\[([^[\]]+)${TARGET}`);
/** What the text before the caret holds for a line break, image or formula. */
const INLINE_NODE = '\ufffc';

/** After an opening backtick still unclosed: the text of a code span. */
function inCodeSpan(match: RegExpMatchArray, lead = 0): boolean {
  const before = match.input?.slice(0, (match.index ?? 0) + lead) ?? '';
  return (before.match(/`/g)?.length ?? 0) % 2 === 1;
}

export function typedLink(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) {
  const [, before = '', label = '', href = '', title] = match;
  const type = state.schema.marks.link;
  if (!type || inCodeSpan(match, before.length)) return null;
  // The brackets go and the text between them takes the link as it stands:
  // made plain text, it lost its bold, and a line break in it was gone with
  // a stray character in its place.
  const from = start + before.length;
  const to = from + 1 + label.length;
  return (
    state.tr
      .delete(to, end)
      .delete(from, from + 1)
      .addMark(from, to - 1, type.create({ href, title: title ?? null }))
      // What is typed next goes after the link, outside it.
      .removeStoredMark(type)
  );
}

export function typedImage(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
) {
  const [, alt = '', src = '', title = ''] = match;
  // A description is text alone.
  if (inCodeSpan(match) || alt.includes(INLINE_NODE)) return null;
  const { nodes } = state.schema;
  const $start = state.doc.resolve(start);
  const line = $start.parent;
  const block = nodes['image-block'];
  const index = $start.index(-1);
  if (
    block &&
    line.type.name === 'paragraph' &&
    start === $start.start() &&
    end === $start.end() &&
    $start.node(-1).canReplaceWith(index, index, block)
  ) {
    const at = $start.before();
    const tr = state.tr.replaceWith(at, $start.after(), [
      block.create({ src, alt, caption: title }),
      line.type.create(),
    ]);
    return caretBelowTypedBlock(tr, at + 2)
      .setSelection(TextSelection.create(tr.doc, at + 2))
      .scrollIntoView();
  }
  const inline = nodes.image;
  if (!inline) return null;
  return state.tr.replaceWith(start, end, inline.create({ src, alt, title }));
}

export const linkInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(IMAGE, typedImage, { inCodeMark: false }),
      new InputRule(LINK, typedLink, { inCodeMark: false }),
    ],
  })
);
