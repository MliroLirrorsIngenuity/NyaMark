/**
 * The source pane's text brought in line with a change made to the editor's
 * document (the assistant's edits accepted there): only the top-level blocks
 * that changed are written anew, so the rest of the text keeps the way the
 * user wrote it.
 */

import type { Node } from '@milkdown/kit/prose/model';
import { matchPairs } from './myers';
import type { BlockSpan } from './source-caret';

export type TextChange = { from: number; to: number; insert: string };

/** Top-level blocks two documents can differ by and still be paired. */
const MAX_COST = 400;

function childrenOf(node: Node, from = 0, to = node.childCount) {
  const list: Node[] = [];
  for (let i = from; i < to; i++) list.push(node.child(i));
  return list;
}

/**
 * The changes that take `text`, which reads as `before` with its top-level
 * blocks at `spans`, to Markdown that reads as `after`: the blocks `after`
 * has in place of some of `before`'s, written by `serialize`. In order, none
 * overlapping. Null when the blocks cannot be found in the text; the caller
 * checks that the result reads as `after`.
 */
export function rewriteBlocks(
  text: string,
  spans: readonly BlockSpan[],
  before: Node,
  after: Node,
  serialize: (doc: Node) => string
): TextChange[] | null {
  const pairs = matchPairs(
    childrenOf(before),
    childrenOf(after),
    (a, b) => a.eq(b),
    MAX_COST
  );
  if (!pairs) return null;
  const changes: TextChange[] = [];
  let ia = 0;
  let ib = 0;
  for (const [pa, pb] of [...pairs, [before.childCount, after.childCount]]) {
    if (pa > ia || pb > ib) {
      const change = gapChange(text, spans, after, ia, pa, ib, pb, serialize);
      if (!change) return null;
      changes.push(change);
    }
    ia = pa + 1;
    ib = pb + 1;
  }
  return changes;
}

/** Blocks `[a0, a1)` of the text written as blocks `[b0, b1)` of `after`. */
function gapChange(
  text: string,
  spans: readonly BlockSpan[],
  after: Node,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  serialize: (doc: Node) => string
): TextChange | null {
  // The trailing paragraph the editor adds has no span.
  if (a1 > spans.length) return null;
  const written =
    b1 > b0
      ? serialize(after.type.create(null, childrenOf(after, b0, b1))).replace(
          /\n+$/,
          ''
        )
      : '';
  if (a1 > a0) {
    const from = spans[a0].from;
    const to = spans[a1 - 1].to;
    if (written) return { from, to, insert: written };
    // Gone with the blank lines that set them apart.
    if (a1 < spans.length) return { from, to: spans[a1].from, insert: '' };
    if (a0 > 0) return { from: spans[a0 - 1].to, to, insert: '' };
    return { from: 0, to: text.length, insert: '' };
  }
  if (a0 < spans.length) {
    const at = spans[a0].from;
    return { from: at, to: at, insert: `${written}\n\n` };
  }
  if (a0 > 0) {
    const at = spans[a0 - 1].to;
    return { from: at, to: at, insert: `\n\n${written}` };
  }
  return { from: 0, to: text.length, insert: `${written}\n` };
}

/** `text` with `changes` made. */
export function applyChanges(text: string, changes: readonly TextChange[]) {
  let out = '';
  let last = 0;
  for (const change of changes) {
    out += text.slice(last, change.from) + change.insert;
    last = change.to;
  }
  return out + text.slice(last);
}
