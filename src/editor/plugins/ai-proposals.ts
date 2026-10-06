/**
 * Changes the assistant proposes, drawn in the document until the user
 * accepts or rejects each. A proposal is no part of the document: its text,
 * its saving and its undo history see none of it until it is accepted,
 * which is then an ordinary change of one undo step.
 *
 * The proposals ("hunks") live in this plugin's state and follow the user's
 * edits. One whose text the user changes no longer applies, and is dropped
 * as a conflict; text typed at its edge leaves it be. Undoing an accept
 * brings its hunks back, and redoing it, or typing what a hunk proposes,
 * takes them as accepted.
 *
 * What the hunks are and how they are drawn come from the assistant, which
 * is loaded on its own; this keeps them in step with the document.
 */

import {
  closeHistory,
  isHistoryTransaction,
} from '@milkdown/kit/prose/history';
import {
  type Fragment,
  Mark,
  type Node as ProseNode,
  type Slice,
} from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { ReplaceStep } from '@milkdown/kit/prose/transform';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export type Hunk = {
  id: number;
  /** The edit the assistant made it in. */
  edit: string;
  /** What `from`..`to` holds now, within one parent node. */
  from: number;
  to: number;
  /** What takes its place when accepted. */
  insert: Slice;
  /** `from`..`to` as it was proposed against; a change to it is a conflict. */
  base: Fragment;
  /** Text within one textblock, or whole nodes. */
  kind: 'inline' | 'block';
};

export type HunkEvent = {
  /** Counts up through the editor's life, to read the events since one. */
  seq: number;
  hunk: Hunk;
  kind: 'accepted' | 'rejected' | 'conflict' | 'restored';
  /** Why a conflict: the user changed it, a reload did, or it did not fit. */
  reason?: 'edited' | 'reload' | 'invalid';
};

/** An accepted hunk, kept to bring back should its accept be undone. */
type Accepted = { hunk: Hunk; from: number; to: number };

export type ProposalState = {
  /** Pending, in document order, none overlapping. */
  hunks: readonly Hunk[];
  accepted: readonly Accepted[];
  decorations: DecorationSet;
  /** The latest events, oldest first. */
  events: readonly HunkEvent[];
  seq: number;
};

export type ProposalMeta =
  /** The pending hunks from now on, in place of those there were. */
  | { type: 'set'; hunks: Hunk[] }
  | { type: 'reject'; ids: number[] }
  /** On the transaction that applies `ids`; `failed` did not fit. */
  | { type: 'accepted'; ids: number[]; failed: number[] }
  | { type: 'clear' };

/** Draws what a hunk puts in, and its accept and reject buttons. */
export type HunkRenderer = (view: EditorView, hunk: Hunk) => HTMLElement;

export const proposalKey = new PluginKey<ProposalState>('nyamark/ai-proposals');

/** Set on a transaction to say where its change came from. */
export const ORIGIN_META = 'nyamark/origin';

const KEEP_EVENTS = 200;
const KEEP_ACCEPTED = 100;

let renderer: HunkRenderer | null = null;
const listeners = new Set<(view: EditorView) => void>();

export function setHunkRenderer(render: HunkRenderer) {
  renderer = render;
}

/** Told after every change to the proposals. Returns the unsubscribe. */
export function onProposalsChange(listener: (view: EditorView) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function proposalState(state: EditorState): ProposalState | undefined {
  return proposalKey.getState(state);
}

/** Attributes that follow from others or from the text, and are no change. */
const DERIVED: Record<string, readonly string[]> = {
  heading: ['id'],
  list_item: ['label', 'spread'],
  bullet_list: ['spread'],
  ordered_list: ['spread'],
};

function attrEqual(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The same type with the same attributes, those derived aside. */
export function sameMarkupRelaxed(a: ProseNode, b: ProseNode): boolean {
  if (a.type !== b.type) return false;
  const derived = DERIVED[a.type.name];
  for (const name of Object.keys(a.attrs)) {
    if (derived?.includes(name)) continue;
    if (!attrEqual(a.attrs[name], b.attrs[name])) return false;
  }
  return Mark.sameSet(a.marks, b.marks);
}

/** Equal but for derived attributes: a heading's id, a list's spacing. */
export function nodesMatch(a: ProseNode, b: ProseNode): boolean {
  if (a === b) return true;
  if (!sameMarkupRelaxed(a, b)) return false;
  if (a.isText) return a.text === b.text;
  return fragmentsMatch(a.content, b.content);
}

export function fragmentsMatch(a: Fragment, b: Fragment): boolean {
  if (a === b) return true;
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    if (!nodesMatch(a.child(i), b.child(i))) return false;
  }
  return true;
}

/**
 * What `from`..`to` holds, when the two lie in one parent as a hunk of
 * `kind` needs; null when they no longer do.
 */
export function hunkContent(
  doc: ProseNode,
  from: number,
  to: number,
  kind: Hunk['kind']
): Fragment | null {
  if (from < 0 || to > doc.content.size || to < from) return null;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.sameParent($to)) return null;
  const { parent } = $from;
  if (kind === 'inline' ? !parent.inlineContent : parent.inlineContent) {
    return null;
  }
  if (kind === 'block' && ($from.textOffset || $to.textOffset)) return null;
  return parent.content.cut($from.parentOffset, $to.parentOffset);
}

/**
 * Where a range lands after `tr`. An empty one takes in what an undo or a
 * redo puts at it, and has what is typed at it go before it. Null when the
 * user deleted across one of its ends: it went with the text around it.
 */
export function mapRange(
  from: number,
  to: number,
  tr: Transaction,
  history: boolean
): { from: number; to: number } | null {
  if (from === to) {
    const start = tr.mapping.mapResult(from, history ? -1 : 1);
    if (start.deletedAcross && !history) return null;
    const end = history ? tr.mapping.map(to, 1) : start.pos;
    return { from: start.pos, to: end };
  }
  const start = tr.mapping.mapResult(from, 1);
  const end = tr.mapping.mapResult(to, -1);
  if (!history && (start.deletedAcross || end.deletedAcross)) return null;
  return end.pos < start.pos ? null : { from: start.pos, to: end.pos };
}

function decorate(doc: ProseNode, hunks: readonly Hunk[]): DecorationSet {
  if (hunks.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const hunk of hunks) {
    const attrs = { 'data-ny-hunk': String(hunk.id) };
    if (hunk.kind === 'inline') {
      if (hunk.to > hunk.from) {
        decorations.push(
          Decoration.inline(
            hunk.from,
            hunk.to,
            { ...attrs, class: 'ny-ai-del' },
            { hunk: hunk.id }
          )
        );
      }
    } else {
      doc.nodesBetween(hunk.from, hunk.to, (node, pos) => {
        const end = pos + node.nodeSize;
        if (pos < hunk.from || end > hunk.to) return true;
        decorations.push(
          Decoration.node(
            pos,
            end,
            { ...attrs, class: 'ny-ai-del-block' },
            { hunk: hunk.id }
          )
        );
        return false;
      });
    }
    decorations.push(
      Decoration.widget(
        hunk.to,
        (view) => {
          const dom = renderer?.(view, hunk) ?? document.createElement('span');
          dom.dataset.nyHunk = String(hunk.id);
          return dom;
        },
        {
          // Typing at a hunk's end goes after it, at an insertion before it.
          side: hunk.from === hunk.to ? 1 : -1,
          key: `ny-hunk-${hunk.id}`,
          hunk: hunk.id,
          marks: [],
          ignoreSelection: true,
          stopEvent: (event: Event) =>
            event.target instanceof Element &&
            event.target.closest('button') != null,
        }
      )
    );
  }
  return DecorationSet.create(doc, decorations);
}

function withEvents(
  value: ProposalState,
  added: Omit<HunkEvent, 'seq'>[]
): Pick<ProposalState, 'events' | 'seq'> {
  if (added.length === 0) return { events: value.events, seq: value.seq };
  let seq = value.seq;
  const events = [
    ...value.events,
    ...added.map((event) => ({ ...event, seq: ++seq })),
  ];
  return { events: events.slice(-KEEP_EVENTS), seq };
}

function isIdle(value: ProposalState) {
  return value.hunks.length === 0 && value.accepted.length === 0;
}

function applyTransaction(
  tr: Transaction,
  value: ProposalState
): ProposalState {
  const meta = tr.getMeta(proposalKey) as ProposalMeta | undefined;
  if (!meta && (!tr.docChanged || isIdle(value))) return value;
  const events: Omit<HunkEvent, 'seq'>[] = [];
  let hunks = value.hunks;
  let accepted = value.accepted;

  if (meta?.type === 'clear') {
    hunks = [];
    accepted = [];
  } else if (meta?.type === 'set') {
    hunks = [...meta.hunks].sort((a, b) => a.from - b.from);
  } else if (meta?.type === 'reject') {
    const ids = new Set(meta.ids);
    for (const hunk of hunks) {
      if (ids.has(hunk.id)) events.push({ hunk, kind: 'rejected' });
    }
    hunks = hunks.filter((hunk) => !ids.has(hunk.id));
  } else if (meta?.type === 'accepted' && meta.failed.length > 0) {
    // Dropped whether or not the others went in.
    const failed = new Set(meta.failed);
    for (const hunk of hunks) {
      if (failed.has(hunk.id)) {
        events.push({ hunk, kind: 'conflict', reason: 'invalid' });
      }
    }
    hunks = hunks.filter((hunk) => !failed.has(hunk.id));
  }

  if (tr.docChanged) {
    const history = isHistoryTransaction(tr);
    const reload = tr.getMeta(ORIGIN_META) === 'reload';
    const acceptedIds =
      meta?.type === 'accepted' ? new Set(meta.ids) : new Set<number>();
    const pending: Hunk[] = [];
    const nowAccepted: Accepted[] = [];

    for (const hunk of hunks) {
      const taken = acceptedIds.has(hunk.id);
      const range = mapRange(hunk.from, hunk.to, tr, history || taken);
      const content =
        range && hunkContent(tr.doc, range.from, range.to, hunk.kind);
      if (range && content && !taken && fragmentsMatch(content, hunk.base)) {
        pending.push({ ...hunk, ...range });
      } else if (
        range &&
        content &&
        fragmentsMatch(content, hunk.insert.content)
      ) {
        nowAccepted.push({ hunk, ...range });
        events.push({ hunk, kind: 'accepted' });
      } else {
        events.push({
          hunk,
          kind: 'conflict',
          reason: reload ? 'reload' : 'edited',
        });
      }
    }

    const kept: Accepted[] = [];
    for (const record of accepted) {
      const range = mapRange(record.from, record.to, tr, history);
      if (!range) continue;
      const content = hunkContent(
        tr.doc,
        range.from,
        range.to,
        record.hunk.kind
      );
      if (!content) continue;
      // Undone: what it replaced is back, and so is the proposal.
      if (
        history &&
        fragmentsMatch(content, record.hunk.base) &&
        !pending.some((hunk) => hunk.from < range.to && range.from < hunk.to)
      ) {
        const hunk = { ...record.hunk, ...range };
        pending.push(hunk);
        events.push({ hunk, kind: 'restored' });
      } else {
        kept.push({ hunk: record.hunk, ...range });
      }
    }
    hunks = pending.sort((a, b) => a.from - b.from);
    accepted = [...kept, ...nowAccepted].slice(-KEEP_ACCEPTED);
  }

  return {
    hunks,
    accepted,
    decorations:
      hunks === value.hunks && !tr.docChanged
        ? value.decorations
        : decorate(tr.doc, hunks),
    ...withEvents(value, events),
  };
}

/** Accepts the hunks `ids` (all when left out) as one undo step. */
export function acceptHunks(view: EditorView, ids?: readonly number[]) {
  const state = proposalKey.getState(view.state);
  if (!state || view.isDestroyed) return;
  // Mid-composition the text is the input method's; once it is done.
  if (view.composing) {
    view.dom.addEventListener(
      'compositionend',
      () => setTimeout(() => acceptHunks(view, ids)),
      { once: true }
    );
    return;
  }
  const wanted = ids && new Set(ids);
  const chosen = state.hunks
    .filter((hunk) => !wanted || wanted.has(hunk.id))
    // An insertion at a hunk's start goes in after that hunk is replaced.
    .sort((a, b) => b.from - a.from || b.to - a.to);
  if (chosen.length === 0) return;
  const tr = view.state.tr;
  const done: number[] = [];
  const failed: number[] = [];
  // From the end back, so each hunk's place is still as it was.
  for (const hunk of chosen) {
    let fits = false;
    try {
      const step = new ReplaceStep(hunk.from, hunk.to, hunk.insert);
      fits = !tr.maybeStep(step).failed;
    } catch {
      // Content its parent cannot hold.
    }
    (fits ? done : failed).push(hunk.id);
  }
  const meta: ProposalMeta = { type: 'accepted', ids: done, failed };
  view.dispatch(closeHistory(tr).setMeta(proposalKey, meta));
  // What is typed next is a step of its own.
  view.dispatch(closeHistory(view.state.tr));
}

/** Drops the hunks `ids` (all when left out); the document stays as it is. */
export function rejectHunks(view: EditorView, ids?: readonly number[]) {
  const state = proposalKey.getState(view.state);
  if (!state || view.isDestroyed) return;
  const chosen = ids ?? state.hunks.map((hunk) => hunk.id);
  if (chosen.length === 0) return;
  const meta: ProposalMeta = { type: 'reject', ids: [...chosen] };
  view.dispatch(view.state.tr.setMeta(proposalKey, meta));
}

/** The plugin itself, apart from the editor (for the tests). */
export function proposalsPlugin() {
  return new Plugin<ProposalState>({
    key: proposalKey,
    state: {
      init: () => ({
        hunks: [],
        accepted: [],
        decorations: DecorationSet.empty,
        events: [],
        seq: 0,
      }),
      apply: (tr, value) => applyTransaction(tr, value),
    },
    props: {
      decorations: (state) => proposalKey.getState(state)?.decorations,
    },
    view: () => ({
      update: (view, previous) => {
        if (
          proposalKey.getState(previous) === proposalKey.getState(view.state)
        ) {
          return;
        }
        for (const listener of listeners) listener(view);
      },
    }),
  });
}

export const aiProposals = $prose(proposalsPlugin);
