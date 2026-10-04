/**
 * A long document opens on its first screens. Drawn whole, every table,
 * code block and diagram of an article two thousand lines long was built
 * and laid out before the first line showed: the window stood empty for
 * seconds. The editor starts on its opening blocks, and the rest follows
 * once the first frame is on screen.
 *
 * The document stays closed to editing until it is all there, so that
 * nothing typed is taken for what the file held.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';

/** Positions drawn at once, a few screens of text and more. */
const OPENING_SIZE = 12000;

/**
 * Whether a document ending on `last` is given an empty paragraph by the
 * trailing plugin. The opening ends on a block it leaves alone: one added
 * there stayed in the middle once the rest came in.
 */
type EndsOpen = (last: ProseNode) => boolean;

export type Opening = { first: ProseNode; rest: ProseNode[] };

/**
 * The opening blocks of `doc` as a document of their own, and the blocks
 * that follow them, or null when it is short enough to draw at once.
 */
export function splitOpening(
  doc: ProseNode,
  endsOpen: EndsOpen
): Opening | null {
  if (doc.content.size < OPENING_SIZE * 2) return null;
  let size = 0;
  for (let index = 0; index < doc.childCount - 1; index += 1) {
    const block = doc.child(index);
    size += block.nodeSize;
    if (size < OPENING_SIZE || endsOpen(block)) continue;
    const rest: ProseNode[] = [];
    for (let next = index + 1; next < doc.childCount; next += 1) {
      rest.push(doc.child(next));
    }
    return { first: doc.copy(doc.content.cut(0, size)), rest };
  }
  return null;
}

/**
 * Adds `rest` at the end of the document once the opening is on screen.
 * Drawn in parts, a frame apart, each part laid the page out again: the
 * whole took up to twice as long to come in, and stayed closed to editing
 * all that while.
 */
export async function drawRest(view: EditorView, rest: ProseNode[]) {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
  if (view.isDestroyed) return;
  const { tr } = view.state;
  tr.insert(tr.doc.content.size, rest);
  view.dispatch(tr.setMeta('addToHistory', false));
}
