/**
 * What a kept conversation holds of the assistant's edits: what became of
 * each, and the changes still waiting with the text they were proposed on,
 * to show again when the document reads the same.
 */

import type { Hunk } from '../../editor/plugins/ai-proposals';

/** What became of an edit's changes, those still waiting aside. */
export type Tally = {
  total: number;
  accepted: number;
  rejected: number;
  /** Dropped as the user changed their text, a reload did, or no fit. */
  dropped: number;
  /** Taken back or redone by a later edit of the assistant's. */
  replaced: number;
};

/** A waiting change, its content as ProseMirror's JSON. */
export type SavedHunk = {
  edit: string;
  from: number;
  to: number;
  kind: Hunk['kind'];
  insert: unknown;
  base: unknown;
};

export type SavedEdits = {
  tallies: Record<string, Tally>;
  /** The changes waiting, and the document's Markdown they lie in. */
  pending: { text: string; hunks: SavedHunk[] } | null;
};

const TALLY_KEYS = [
  'total',
  'accepted',
  'rejected',
  'dropped',
  'replaced',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

function readTally(value: unknown): Tally | null {
  if (!isRecord(value)) return null;
  const tally = {} as Tally;
  for (const key of TALLY_KEYS) {
    const number = count(value[key]);
    if (number == null) return null;
    tally[key] = number;
  }
  return tally;
}

function readHunk(value: unknown): SavedHunk | null {
  if (!isRecord(value) || typeof value.edit !== 'string') return null;
  const from = count(value.from);
  const to = count(value.to);
  if (from == null || to == null || to < from) return null;
  if (value.kind !== 'inline' && value.kind !== 'block') return null;
  return {
    edit: value.edit,
    from,
    to,
    kind: value.kind,
    insert: value.insert ?? null,
    base: value.base ?? null,
  };
}

/** What `save` gave, as read back from disk; null for anything else. */
export function readSavedEdits(value: unknown): SavedEdits | null {
  if (!isRecord(value)) return null;
  const tallies: Record<string, Tally> = {};
  if (isRecord(value.tallies)) {
    for (const [edit, item] of Object.entries(value.tallies)) {
      const tally = readTally(item);
      if (tally) tallies[edit] = tally;
    }
  }
  let pending: SavedEdits['pending'] = null;
  const saved = value.pending;
  if (
    isRecord(saved) &&
    typeof saved.text === 'string' &&
    Array.isArray(saved.hunks)
  ) {
    const hunks: SavedHunk[] = [];
    for (const item of saved.hunks) {
      const hunk = readHunk(item);
      if (hunk) hunks.push(hunk);
    }
    if (hunks.length) pending = { text: saved.text, hunks };
  }
  return { tallies, pending };
}
