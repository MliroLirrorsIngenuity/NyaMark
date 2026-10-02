/**
 * `[^1]` typed into a line becomes the mark of footnote 1 once its closing
 * bracket is typed, and `[^1]: ` typed at the start of a line makes the line
 * that footnote, as they open from a file. Milkdown has no rule for either:
 * they stayed text and were saved escaped, `\[^1]`, which nothing reads as a
 * footnote.
 *
 * The mark is made as soon as `]` is typed, so a footnote typed at the start
 * of a line already starts with one when `: ` follows; either way the line
 * becomes the footnote. Backspace right after turns it back into the text
 * typed, as it does after the other shortcuts.
 *
 * Backspace at the start of a footnote takes the space out of the `[^1]: `
 * it reads as: the line goes back to text, `[^1]:` in front of what it says,
 * and a space typed there makes it the footnote again. The footnote's text
 * ran into the line above it, and its number was gone.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** A footnote's label: no space, bracket, caret or backslash in it. */
const LABEL = String.raw`([^\s[\]^\\]+)`;
// Not after `\`, which keeps the bracket text.
export const REFERENCE = new RegExp(String.raw`(^|[^\\])\[\^${LABEL}\]$`);
/** What a footnote mark, as an atom, stands as in the text before the caret. */
const MARK = '\ufffc';
/** The start of a line, as text or as the mark already made of it. */
export const DEFINITION = new RegExp(
  String.raw`^(?:\[\^${LABEL}\]|${MARK}):\s$`
);

export function typedReference(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
): Transaction | null {
  const [, before = '', label = ''] = match;
  const type = state.schema.nodes.footnote_reference;
  if (!type) return null;
  return state.tr.replaceWith(
    start + before.length,
    end,
    type.create({ label })
  );
}

export function typedDefinition(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number
): Transaction | null {
  const { footnote_definition: type, footnote_reference: mark } =
    state.schema.nodes;
  const $start = state.doc.resolve(start);
  const line = $start.parent;
  if (!type || line.type.name !== 'paragraph') return null;
  if (start !== $start.start()) return null;
  const label = match[1] ?? line.firstChild?.attrs.label;
  if (!match[1] && line.firstChild?.type !== mark) return null;
  const rest = line.copy(line.content.cut(end - $start.start()));
  if ($start.depth === 1) {
    const at = $start.before();
    const tr = state.tr.replaceWith(
      at,
      $start.after(),
      type.create({ label }, rest)
    );
    return tr.setSelection(TextSelection.create(tr.doc, at + 2));
  }
  // A line further down a footnote, where Enter after its text leaves the
  // caret: the footnote ends above it and the line starts the next one, with
  // the lines under it. It stayed a line of the footnote above, its number
  // a mark in it.
  const note = $start.node(1);
  if ($start.depth !== 2 || note.type !== type || $start.index(1) === 0) {
    return null;
  }
  const inside = $start.start(1);
  const kept = note.copy(note.content.cut(0, $start.before() - inside));
  const next = type.create(
    { label },
    Fragment.from(rest).append(note.content.cut($start.after() - inside))
  );
  const at = $start.before(1);
  const tr = state.tr.replaceWith(at, $start.after(1), [kept, next]);
  return tr.setSelection(TextSelection.create(tr.doc, at + kept.nodeSize + 2));
}

/** The footnote the caret starts the first line of, back to text. */
export function footnoteToText(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const { depth } = $from;
  if (depth < 2 || $from.parent.type.name !== 'paragraph') return null;
  const note = $from.node(depth - 1);
  if (note.type.name !== 'footnote_definition') return null;
  if ($from.index(depth - 1) !== 0) return null;
  const head = `[^${note.attrs.label}]:`;
  const line = $from.parent;
  const blocks: Node[] = [
    line.copy(Fragment.from(state.schema.text(head)).append(line.content)),
  ];
  note.forEach((block, _offset, index) => {
    if (index > 0) blocks.push(block);
  });
  const at = $from.before(depth - 1);
  const tr = state.tr.replaceWith(at, at + note.nodeSize, blocks);
  return tr.setSelection(TextSelection.create(tr.doc, at + 1 + head.length));
}

export const footnoteInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(DEFINITION, typedDefinition, { inCodeMark: false }),
      new InputRule(REFERENCE, typedReference, { inCodeMark: false }),
    ],
  })
);
