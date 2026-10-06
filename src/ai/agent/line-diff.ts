/**
 * What a write to a note changes, line by line, as the panel shows it for
 * the user to allow: the lines taken out and put in, a few kept lines
 * around each change, and a gap row for the kept lines between.
 */

import { matchPairs } from '../../editor/myers';
import { documentLines } from './document-text';

export type DiffRow = {
  kind: 'same' | 'removed' | 'added' | 'gap';
  /** The line; for a gap, how many lines it stands for. */
  text: string;
};

export type LineDiff = {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** Rows were left out past the most a diff shows. */
  truncated: boolean;
};

/** Kept lines shown either side of a change. */
const CONTEXT = 2;
/** The most rows a diff shows. */
const MAX_ROWS = 120;
/** Past this many changed lines, the middle is taken as all new. */
const MAX_COST = 2000;

export function lineDiff(before: string, after: string): LineDiff {
  const a = documentLines(before);
  const b = documentLines(after);
  const pairs = matchPairs(a, b, (x, y) => x === y, MAX_COST) ?? [];
  const all: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let ia = 0;
  let ib = 0;
  for (const [pa, pb] of [...pairs, [a.length, b.length] as const]) {
    for (; ia < pa; ia++, removed++) {
      all.push({ kind: 'removed', text: a[ia] });
    }
    for (; ib < pb; ib++, added++) all.push({ kind: 'added', text: b[ib] });
    if (pa < a.length) all.push({ kind: 'same', text: a[pa] });
    ia = pa + 1;
    ib = pb + 1;
  }
  const rows: DiffRow[] = [];
  let truncated = false;
  const push = (row: DiffRow) => {
    if (rows.length < MAX_ROWS) rows.push(row);
    else truncated = true;
  };
  for (let i = 0; i < all.length; ) {
    if (all[i].kind !== 'same') {
      push(all[i++]);
      continue;
    }
    let end = i;
    while (end < all.length && all[end].kind === 'same') end++;
    const keepBefore = i === 0 ? 0 : CONTEXT;
    const keepAfter = end === all.length ? 0 : CONTEXT;
    if (end - i <= keepBefore + keepAfter + 1) {
      for (; i < end; i++) push(all[i]);
      continue;
    }
    for (let k = 0; k < keepBefore; k++) push(all[i + k]);
    push({ kind: 'gap', text: String(end - i - keepBefore - keepAfter) });
    for (let k = end - keepAfter; k < end; k++) push(all[k]);
    i = end;
  }
  return { rows, added, removed, truncated };
}
