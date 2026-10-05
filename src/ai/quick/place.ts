/**
 * Where the reply to a command of the AI or slash menu goes in the
 * document's Markdown: over the selection, on at the caret, or as blocks of
 * its own on the caret's line or after it. The user may type while the
 * model writes, so the place is found again in the text as it is then.
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

/** Where the reply goes, in the text as it was when the command ran. */
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

/**
 * How much of the text either side finds the range again, the most first:
 * typing close by leaves less of it as it was.
 */
const CONTEXTS = [64, 24, 8];
/** The shortest text found again by itself. */
const FINDABLE = 8;

function uniqueIndex(text: string, search: string): number {
  if (!search) return -1;
  const at = text.indexOf(search);
  if (at < 0 || text.indexOf(search, at + 1) >= 0) return -1;
  return at;
}

/**
 * The range `from`–`to` of `before` in `now`, the text after the user went
 * on writing: null when it is no longer there, or no longer only once.
 */
export function relocate(
  before: string,
  now: string,
  from: number,
  to: number
): { from: number; to: number } | null {
  if (before === now) return { from, to };
  const middle = before.slice(from, to);
  // Typing after the range, or before it.
  if (now.slice(0, to) === before.slice(0, to)) return { from, to };
  const back = before.length - from;
  if (
    back <= now.length &&
    now.slice(now.length - back) === before.slice(from)
  ) {
    const start = now.length - back;
    return { from: start, to: start + middle.length };
  }
  for (const size of CONTEXTS) {
    const lead = before.slice(Math.max(0, from - size), from);
    const trail = before.slice(to, to + size);
    for (const [head, tail] of [
      [lead, trail],
      [lead, ''],
      ['', trail],
    ]) {
      if (!head && !tail) continue;
      const at = uniqueIndex(now, head + middle + tail);
      if (at >= 0) {
        const start = at + head.length;
        return { from: start, to: start + middle.length };
      }
    }
  }
  if (middle.length >= FINDABLE) {
    const alone = uniqueIndex(now, middle);
    if (alone >= 0) return { from: alone, to: alone + middle.length };
  }
  return null;
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
 * The edit putting `reply` in at `target` of `before`, the text when the
 * command ran, as it lands in `now`, the text as it is.
 */
export function quickEdit(
  before: string,
  now: string,
  target: Target,
  reply: string
): TextEdit {
  const found = relocate(before, now, target.from, target.to);
  if (!found) {
    throw new EditError(
      'not_found',
      'The text changed where the reply was to go.'
    );
  }
  const { from, to } = found;
  const head = now.slice(0, from);
  const rest = now.slice(to);
  let insert: string;
  if (target.blocks) insert = asBlocks(head, reply, rest);
  else if (from === to) insert = continuation(head, reply);
  else insert = reply;
  const next = head + insert + rest;
  if (next === now) {
    throw new EditError('no_change', 'The reply is the text as it is.');
  }
  return { next, from, to };
}
