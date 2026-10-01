import { type Node as ProseMirrorNode, Slice } from '@milkdown/kit/prose/model';
import type { Transaction } from '@milkdown/kit/prose/state';

/**
 * Adds to `tr` the smallest replace step that turns its document into `next`.
 * Leaves `tr` untouched when the two documents are already equal.
 */
export function replaceChangedRange(tr: Transaction, next: ProseMirrorNode) {
  const current = tr.doc;
  const start = current.content.findDiffStart(next.content);
  const end = current.content.findDiffEnd(next.content);
  if (start == null || !end) return tr;
  let { a: endA, b: endB } = end;
  // Repeated text can make the common suffix overlap the common prefix.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  tr.replace(start, endA, next.slice(start, endB));
  // Should the slice not fit back exactly, swap the whole content instead.
  if (!tr.doc.eq(next)) {
    tr.replace(0, tr.doc.content.size, new Slice(next.content, 0, 0));
  }
  return tr;
}
