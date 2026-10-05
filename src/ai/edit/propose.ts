/**
 * An edit of the assistant's made into hunks. The assistant reads and edits
 * the document as Markdown with its pending proposals in it (the "view");
 * an edit is read back into blocks, and only the blocks it changed are
 * compared with the document, so the rest of the text going through
 * Markdown and back shows up as no change.
 *
 * The blocks the edit touched are set against the same blocks of the
 * document, together with any pending hunks among them, which the new hunks
 * take the place of. Each hunk can be accepted alone and all of them at
 * once; where they could not, the whole stretch becomes one hunk.
 */

import {
  Fragment,
  type Node as ProseNode,
  Slice,
} from '@milkdown/kit/prose/model';
import { ReplaceStep, Transform } from '@milkdown/kit/prose/transform';
import { matchPairs } from '../../editor/myers';
import {
  type Hunk,
  hunkContent,
  nodesMatch,
} from '../../editor/plugins/ai-proposals';
import type { BlockSpan } from '../../editor/source-caret';
import { lineAt } from '../agent/document-text';
import { type HunkDraft, alignBlocks } from './align';
import { EditError, type TextEdit } from './text-edit';

export type EditEnv = {
  /** Markdown read as the editor holds it; null while it is not up. */
  parse(markdown: string): ProseNode | null;
  serialize(doc: ProseNode): string;
  /** Where each top-level block of `markdown` sits in it. */
  blockSpans(markdown: string): BlockSpan[];
};

type Placed = { from: number; to: number; insert: Slice };

export type NewHunk = HunkDraft & { base: Fragment };

export type Proposed = {
  hunks: NewHunk[];
  /** Ids of the pending hunks the new ones take the place of. */
  dropped: number[];
  /** The text the edit was made on. */
  before: string;
  /** The text the edit gave. */
  intended: string;
  /** The text with every pending hunk, new and old, accepted. */
  after: string;
};

/** Blocks two edits can be apart and still count as one. */
const MAX_BLOCK_COST = 400;
/** Blocks past the edited text that may read differently after it. */
const MAX_KNOCK_ON = 2;

const byPlaceDescending = (a: Placed, b: Placed) =>
  b.from - a.from || b.to - a.to;

/**
 * `doc` with `hunks` accepted, in a transform that maps positions across;
 * null when one of them does not fit.
 */
export function applyHunks(
  doc: ProseNode,
  hunks: readonly Placed[]
): Transform | null {
  const transform = new Transform(doc);
  for (const hunk of [...hunks].sort(byPlaceDescending)) {
    try {
      const step = new ReplaceStep(hunk.from, hunk.to, hunk.insert);
      if (transform.maybeStep(step).failed) return null;
    } catch {
      return null;
    }
  }
  try {
    transform.doc.check();
  } catch {
    return null;
  }
  return transform;
}

function children(node: ProseNode, from = 0, to = node.childCount) {
  const list: ProseNode[] = [];
  for (let i = from; i < to; i++) list.push(node.child(i));
  return list;
}

function childPos(doc: ProseNode, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** A stretch of top-level blocks, in the document and in the view. */
type Unit = { c0: number; c1: number; v0: number; v1: number; hunk: boolean };

/**
 * The document's top-level blocks against the view's: one to one, but for
 * the pending hunks that replace whole top-level blocks.
 */
function unitsOf(doc: ProseNode, view: ProseNode, hunks: readonly Hunk[]) {
  const tops = hunks
    .filter(
      (hunk) => hunk.kind === 'block' && doc.resolve(hunk.from).depth === 0
    )
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const units: Unit[] = [];
  let c = 0;
  let v = 0;
  const same = (until: number) => {
    for (; c < until; c++, v++) {
      units.push({ c0: c, c1: c + 1, v0: v, v1: v + 1, hunk: false });
    }
  };
  for (const hunk of tops) {
    const c0 = doc.resolve(hunk.from).index(0);
    const c1 = doc.resolve(hunk.to).index(0);
    same(c0);
    const v1 = v + hunk.insert.content.childCount;
    units.push({ c0, c1, v0: v, v1, hunk: true });
    c = c1;
    v = v1;
  }
  same(doc.childCount);
  return v === view.childCount ? units : null;
}

/**
 * The stretch of the view's blocks `[a, b)` grown to take in whole the
 * pending hunks it meets, and that stretch in the document.
 */
function growToUnits(units: readonly Unit[], a: number, b: number) {
  let first = -1;
  let last = -1;
  units.forEach((unit, index) => {
    const meets = unit.hunk
      ? unit.v0 <= b && unit.v1 >= a
      : unit.v0 < b && unit.v1 > a;
    if (!meets) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) {
    const next = units.find((unit) => unit.v0 >= a);
    const c = next ? next.c0 : (units[units.length - 1]?.c1 ?? 0);
    return { a, b, c, d: c };
  }
  return {
    a: Math.min(a, units[first].v0),
    b: Math.max(b, units[last].v1),
    c: units[first].c0,
    d: units[last].c1,
  };
}

/**
 * Blocks `[from, to)` of `parsed` (the view read back from Markdown) as a
 * stretch of the view, and the stretch of `parsed` that matches it: one to
 * one when the two have as many blocks, else between the nearest blocks
 * that match on either side.
 */
function toView(
  parsed: ProseNode,
  view: ProseNode,
  from: number,
  to: number
): { a: number; b: number; from: number; to: number } {
  if (parsed.childCount === view.childCount)
    return { a: from, b: to, from, to };
  const pairs = matchPairs(
    children(parsed),
    children(view),
    nodesMatch,
    MAX_BLOCK_COST
  );
  if (!pairs) {
    return { a: 0, b: view.childCount, from: 0, to: parsed.childCount };
  }
  let a = 0;
  let start = 0;
  let b = view.childCount;
  let end = parsed.childCount;
  for (const [pi, vi] of pairs) {
    if (pi < from) {
      a = vi + 1;
      start = pi + 1;
    } else if (pi >= to) {
      b = vi;
      end = pi;
      break;
    }
  }
  return { a, b, from: start, to: end };
}

/**
 * Refuses an edit that changes how the text past it reads: most often a
 * code fence, math block or front matter it opens and does not close.
 */
function checkKnockOn(
  env: EditEnv,
  text: string,
  parsed: ProseNode,
  from: number,
  to: number,
  edit: TextEdit
) {
  const spans = env.blockSpans(text);
  // A trailing empty paragraph the editor adds has no span.
  if (
    spans.length < parsed.childCount - 1 ||
    spans.length > parsed.childCount
  ) {
    return;
  }
  const outside: BlockSpan[] = [];
  for (let i = from; i < to && i < spans.length; i++) {
    const span = spans[i];
    if (span.to < edit.from || span.from > edit.to) outside.push(span);
  }
  if (outside.length <= MAX_KNOCK_ON) return;
  const first = lineAt(text, outside[0].from);
  const last = lineAt(text, outside[outside.length - 1].to);
  throw new EditError(
    'restructures_document',
    `This edit changes how ${outside.length} blocks outside the text it replaces read as Markdown (lines ${first}–${last} as they are now). Most often new_string opens a code fence, math block, HTML block or front matter and does not close it. Nothing was changed.`
  );
}

/**
 * Makes the edit `edit` on the view of `doc` with `pending` in it, as new
 * hunks on `doc`. Throws an `EditError` when it cannot be made.
 */
export function proposeEdit(
  env: EditEnv,
  doc: ProseNode,
  pending: readonly Hunk[],
  edit: (text: string) => TextEdit
): Proposed {
  const shown = applyHunks(doc, pending);
  // Pending hunks that no longer fit are left out of the view.
  const live = shown ? pending : [];
  const view = shown?.doc ?? doc;
  const before = env.serialize(view);
  const change = edit(before);
  const intended = change.next;
  const parsed = env.parse(before);
  const next = env.parse(intended);
  if (!parsed || !next) {
    throw new EditError('not_ready', 'The editor is still opening; try again.');
  }

  const nb = parsed.childCount;
  const nn = next.childCount;
  let head = 0;
  while (
    head < nb &&
    head < nn &&
    nodesMatch(parsed.child(head), next.child(head))
  ) {
    head++;
  }
  let tail = 0;
  while (
    tail < nb - head &&
    tail < nn - head &&
    nodesMatch(parsed.child(nb - 1 - tail), next.child(nn - 1 - tail))
  ) {
    tail++;
  }
  if (head + tail === nb && head + tail === nn) {
    throw new EditError(
      'no_change',
      'Read as Markdown, the edit changes nothing: the document already reads that way.'
    );
  }
  if (!change.whole) checkKnockOn(env, before, parsed, head, nb - tail, change);

  const units = unitsOf(doc, view, live);
  const placed = toView(parsed, view, head, nb - tail);
  const region = units
    ? growToUnits(units, placed.a, placed.b)
    : { a: 0, b: view.childCount, c: 0, d: doc.childCount };
  const replacement = [
    ...children(view, region.a, placed.a),
    ...children(next, placed.from, nn - (nb - placed.to)),
    ...children(view, placed.b, region.b),
  ];
  const start = childPos(doc, region.c);
  const end = childPos(doc, region.d);
  const dropped = live.filter((hunk) => hunk.from >= start && hunk.to <= end);
  const kept = live.filter((hunk) => !dropped.includes(hunk));

  const whole: HunkDraft[] = [
    {
      from: start,
      to: end,
      insert: Fragment.fromArray(replacement),
      kind: 'block',
    },
  ];
  for (const drafts of [
    alignBlocks(children(doc, region.c, region.d), start, replacement),
    whole,
  ]) {
    const hunks = withBase(doc, drafts);
    if (!hunks) continue;
    const slices = hunks.map((hunk) => ({
      from: hunk.from,
      to: hunk.to,
      insert: new Slice(hunk.insert, 0, 0),
    }));
    if (!slices.every((slice) => applyHunks(doc, [slice]))) continue;
    const all = applyHunks(doc, [...kept, ...slices]);
    if (!all) continue;
    if (hunks.length === 0 && dropped.length === 0) {
      throw new EditError(
        'no_change',
        'Read as Markdown, the edit changes nothing: the document already reads that way.'
      );
    }
    return {
      hunks,
      dropped: dropped.map((hunk) => hunk.id),
      before,
      intended,
      after: env.serialize(all.doc),
    };
  }
  throw new EditError(
    'invalid',
    'The edit would leave the document in a shape the editor cannot hold. Nothing was changed.'
  );
}

function withBase(
  doc: ProseNode,
  drafts: readonly HunkDraft[]
): NewHunk[] | null {
  const hunks: NewHunk[] = [];
  for (const draft of drafts) {
    const base = hunkContent(doc, draft.from, draft.to, draft.kind);
    if (!base) return null;
    hunks.push({ ...draft, base });
  }
  return hunks;
}
