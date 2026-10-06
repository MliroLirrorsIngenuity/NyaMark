/**
 * Where the reply to a command of the AI or slash menu goes in the
 * document's Markdown: over the selection, on at the caret, or as blocks of
 * its own on the caret's line or after it. The user may type while the
 * model writes; the editor keeps the selection up with the edits (see
 * ai-places), and the place is taken again from it once the reply comes.
 */

import { EditError, type TextEdit } from '../edit/text-edit';
import { continuation } from './prompt';

/** Where the selection and the caret were, in the document's Markdown. */
export type Placement = {
  /** The document's Markdown, the pending proposals in it. */
  text: string;
  /** The text the selection covers, with any markup it cut through. */
  selection: { from: number; to: number } | null;
  /** Where text typed at the caret would go. */
  caret: number;
  /** The top-level block the caret is in, and whether it is an empty line. */
  block: { from: number; to: number; empty: boolean };
  /** The id the editor keeps the selection by; null with no editor. */
  kept: number | null;
};

/** How the reply goes in. */
export type Landing =
  /** Over the selection. */
  | 'replace'
  /** On from the caret, in its line. */
  | 'continue'
  /** As blocks of their own, after the caret's block. */
  | 'blocks';

/** The range the reply takes, and whether it goes in as blocks. */
export type Target = { from: number; to: number; blocks: boolean };

/** Where the reply goes in the text of `placement`. */
export function landingTarget(placement: Placement, landing: Landing): Target {
  const { selection, caret, block } = placement;
  if (landing === 'replace' && selection)
    return { ...selection, blocks: false };
  // On an empty line, such as the one a slash command leaves, the reply
  // takes the line's place.
  if (block.empty) return { from: block.from, to: block.to, blocks: true };
  if (landing === 'continue') return { from: caret, to: caret, blocks: false };
  return { from: block.to, to: block.to, blocks: true };
}

/** `reply` as blocks of its own between `head` and `rest`. */
function asBlocks(head: string, reply: string, rest: string): string {
  const lead =
    !head || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n';
  const trail =
    !rest || rest.startsWith('\n\n')
      ? ''
      : rest.startsWith('\n')
        ? '\n'
        : '\n\n';
  return `${lead}${reply.trim()}${trail}`;
}

/**
 * The edit putting `reply` in where `landing` takes it in `now`, the place
 * the command ran as the user's edits since have left it. Text the reply
 * goes in place of has to read as it did in `before`, when the command ran.
 */
export function quickEdit(
  before: Placement,
  now: Placement,
  landing: Landing,
  reply: string
): TextEdit {
  const was = landingTarget(before, landing);
  const target = landingTarget(now, landing);
  const { from, to } = target;
  if (before.text.slice(was.from, was.to) !== now.text.slice(from, to)) {
    throw new EditError(
      'not_found',
      'The text changed where the reply was to go.'
    );
  }
  const head = now.text.slice(0, from);
  const rest = now.text.slice(to);
  let insert: string;
  if (target.blocks) insert = asBlocks(head, reply, rest);
  else if (from === to) insert = continuation(head, reply);
  else insert = reply;
  const next = head + insert + rest;
  if (next === now.text) {
    throw new EditError('no_change', 'The reply is the text as it is.');
  }
  return { next, from, to };
}
