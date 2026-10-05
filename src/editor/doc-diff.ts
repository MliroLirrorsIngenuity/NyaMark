import {
  type Fragment,
  type Node as ProseMirrorNode,
  Slice,
} from '@milkdown/kit/prose/model';
import type { Transaction } from '@milkdown/kit/prose/state';
import { Transform } from '@milkdown/kit/prose/transform';
import { matchPairs } from './myers';

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

/** Top-level blocks two documents can differ by and still be paired. */
const MAX_RUN_COST = 400;

/**
 * Like `replaceChangedRange`, but the top-level blocks the two documents
 * share are left alone: the blocks are paired in order, and each stretch
 * between pairs that differs is replaced on its own. What lives on those
 * blocks (the assistant's proposals among it) then stays where it is.
 */
export function replaceChangedRuns(tr: Transaction, next: ProseMirrorNode) {
  const a = tr.doc.content;
  const b = next.content;
  const pairs = matchPairs(
    childrenOf(a),
    childrenOf(b),
    (x, y) => x.eq(y),
    MAX_RUN_COST
  );
  if (!pairs) return replaceChangedRange(tr, next);
  const startsA = startsOf(a);
  const startsB = startsOf(b);
  const gaps: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  let ia = 0;
  let ib = 0;
  for (const [pa, pb] of [...pairs, [a.childCount, b.childCount]]) {
    if (pa > ia || pb > ib) {
      gaps.push({
        fromA: startsA[ia],
        toA: startsA[pa],
        fromB: startsB[ib],
        toB: startsB[pb],
      });
    }
    ia = pa + 1;
    ib = pb + 1;
  }
  // From the last back, so the places of those before stay as they were.
  for (const gap of gaps.reverse()) {
    const runA = a.cut(gap.fromA, gap.toA);
    const runB = b.cut(gap.fromB, gap.toB);
    const start = runA.findDiffStart(runB);
    const end = runA.findDiffEnd(runB);
    if (start == null || !end) continue;
    let { a: endA, b: endB } = end;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    tr.replace(
      gap.fromA + start,
      gap.fromA + endA,
      next.slice(gap.fromB + start, gap.fromB + endB)
    );
  }
  if (!tr.doc.eq(next)) {
    tr.replace(0, tr.doc.content.size, new Slice(next.content, 0, 0));
  }
  return tr;
}

function childrenOf(fragment: Fragment) {
  const list: ProseMirrorNode[] = [];
  for (let index = 0; index < fragment.childCount; index++) {
    list.push(fragment.child(index));
  }
  return list;
}

/** Where each child of `fragment` starts, and its end last. */
function startsOf(fragment: Fragment) {
  const starts = [0];
  for (let index = 0; index < fragment.childCount; index++) {
    starts.push(starts[index] + fragment.child(index).nodeSize);
  }
  return starts;
}

/**
 * `parsed` as the editor's plugins leave a parsed document: each heading with
 * text carries the id `headingId` gives it, a repeat numbered `-#2`, `-#3` as
 * Milkdown's syncHeadingIdPlugin does, and `trailing` adds the empty
 * paragraph the trailing plugin puts after a last block of another kind.
 * Diffed without them, each sync from the source pane differed from the first
 * heading to the end and replaced all of it.
 */
export function settleParsed(
  parsed: ProseMirrorNode,
  headingId: (heading: ProseMirrorNode) => string,
  trailing: (last: ProseMirrorNode | null) => ProseMirrorNode | undefined
) {
  const transform = new Transform(parsed);
  const seen = new Map<string, number>();
  parsed.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !node.textContent.trim()) return;
    let id = headingId(node);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id += `-#${count}`;
    if (node.attrs.id !== id) {
      transform.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    }
  });
  const end = trailing(transform.doc.lastChild);
  if (end) transform.insert(transform.doc.content.size, end);
  return transform.doc;
}

/**
 * The one change that turns `current` into `next`: what lies between their
 * common start and common end. Neither end splits a surrogate pair.
 */
export function textChange(current: string, next: string) {
  const shorter = Math.min(current.length, next.length);
  let from = 0;
  while (from < shorter && current[from] === next[from]) from++;
  let tail = 0;
  while (
    tail < shorter - from &&
    current[current.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }
  const isLow = (text: string, at: number) =>
    /[\uDC00-\uDFFF]/.test(text[at] ?? '');
  if (from > 0 && isLow(current, from)) from--;
  if (tail > 0 && isLow(current, current.length - tail)) tail--;
  return {
    from,
    to: current.length - tail,
    insert: next.slice(from, next.length - tail),
  };
}
