/**
 * The assistant's edits to the open document: read with its proposals in
 * it, made into proposals (or applied right away, as the settings say),
 * accepted and rejected from the document or the panel, and told back to the
 * assistant as they are taken or turned down.
 */

import {
  Fragment,
  type Node as ProseNode,
  Slice,
} from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { NyaEditor } from '../../editor/editor';
import {
  dropPlace,
  keepPlace,
  keptPlace,
} from '../../editor/plugins/ai-places';
import {
  type Hunk,
  type ProposalMeta,
  acceptHunks,
  fragmentsMatch,
  hunkContent,
  onProposalsChange,
  proposalKey,
  proposalState,
  rejectHunks,
  setHunkRenderer,
} from '../../editor/plugins/ai-proposals';
import { type BlockSpan, sourceOffset } from '../../editor/source-caret';
import type { AiEditMode } from '../../state/ai-settings';
import type { DocumentSnapshot } from '../agent/document-text';
import { type Landing, type Placement, quickEdit } from '../quick/place';
import { type EditEnv, applyHunks, proposeEdit } from './propose';
import { renderHunk } from './render';
import {
  type EditReport,
  changedLines,
  editReport,
  noticeText,
} from './report';
import {
  type SavedEdits,
  type SavedHunk,
  type Tally,
  readSavedEdits,
} from './saved-edits';
import { EditError, type TextEdit } from './text-edit';

/** A textblock's leaves as text: a line break, or nothing. */
const leafText = (node: ProseNode) =>
  node.type.name === 'hardbreak' ? '\n' : '';

/** Text with its white space taken out, to compare what two texts read. */
const bare = (text: string) => text.replace(/\s+/g, '');

/** The top-level blocks the selection `from`–`to` runs over, whole. */
function wholeBlocks(
  doc: ProseNode,
  from: number,
  to: number,
  spans: readonly BlockSpan[],
  start: number,
  end: number
): { from: number; to: number } {
  const first = spans[doc.resolve(from).index(0)];
  const last = spans[Math.min(doc.resolve(to).index(0), spans.length - 1)];
  return {
    from: Math.min(start, first?.from ?? start),
    to: Math.max(end, last?.to ?? end),
  };
}

export type EditHost = {
  editor: NyaEditor;
  /**
   * The source pane's selection in the editor's document, its edits pushed
   * there first; null outside source mode.
   */
  sourceSelection(): { from: number; to: number } | null;
  /** Pushes the source pane's edits into the editor; nothing outside it. */
  flushSource(): void;
  /** Has the source pane follow a change made to the editor from `before`. */
  followSource(before: ProseNode): void;
  editMode(): AiEditMode;
  localImage(src: string): Promise<string | null>;
  /**
   * Set apart in each edit's id, so the edits of a conversation kept from
   * an earlier run are told apart from this run's.
   */
  editTag?: string;
};

/** What became of an edit's changes. */
export type EditOutcome = Tally & { pending: number };

/** How long a revealed change stays marked. */
const MARK_MS = 1600;

export type EditResult = { report: EditReport; notices: string | null };

export class EditController {
  private edits = 0;
  private hunkIds = 0;
  /** The last event the assistant was told of. */
  private seenSeq = 0;
  /** The last event counted into `tallies`. */
  private countedSeq = 0;
  /** The text with its proposals as the assistant last saw it. */
  private lastText: string | null = null;
  private readonly tallies = new Map<string, Tally>();
  /** The edits of this conversation, the ones its notices tell of. */
  private readonly ownEdits = new Set<string>();
  private current: number | null = null;
  private markTimer: number | null = null;
  /** Kept changes to show again once the document is ready. */
  private waiting: SavedEdits['pending'] = null;
  /** Counts the restores, to drop one overtaken by another or a reset. */
  private restores = 0;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly host: EditHost) {
    setHunkRenderer((view, hunk) =>
      renderHunk(view, hunk, {
        accept: (id) => this.accept([id]),
        reject: (id) => this.reject([id]),
        localImage: (src) => host.localImage(src),
      })
    );
    const state = this.state();
    if (state) {
      this.seenSeq = state.seq;
      this.countedSeq = state.seq;
    }
    this.cleanups.push(onProposalsChange(() => this.changed()));
  }

  /** Told whenever the proposals or what became of them change. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy() {
    for (const cleanup of this.cleanups) cleanup();
    this.listeners.clear();
    if (this.markTimer != null) window.clearTimeout(this.markTimer);
  }

  /** A new conversation, which knows none of the earlier edits. */
  reset() {
    this.seenSeq = this.state()?.seq ?? this.seenSeq;
    this.lastText = null;
    this.ownEdits.clear();
    this.waiting = null;
    this.restores++;
  }

  /** What to keep of this conversation's edits, to `restore` later. */
  save(): SavedEdits {
    const tallies: Record<string, Tally> = {};
    for (const edit of this.ownEdits) {
      const tally = this.tallies.get(edit);
      if (tally) tallies[edit] = { ...tally };
    }
    if (this.waiting) return { tallies, pending: this.waiting };
    const { editor } = this.host;
    const view = editor.getView();
    const hunks = this.pending().filter((hunk) => this.ownEdits.has(hunk.edit));
    if (!view || hunks.length === 0) return { tallies, pending: null };
    return {
      tallies,
      pending: {
        text: editor.serializeDoc(view.state.doc),
        hunks: hunks.map((hunk) => ({
          edit: hunk.edit,
          from: hunk.from,
          to: hunk.to,
          kind: hunk.kind,
          insert: hunk.insert.toJSON(),
          base: hunk.base.toJSON(),
        })),
      },
    };
  }

  /**
   * A kept conversation's edits in place of this one's. Its changes still
   * waiting show again where the document reads as it did, beside none
   * already shown; those that cannot count as dropped. An edit this window
   * knows already is left as it is: what became of it is counted, and its
   * changes still waiting are shown.
   */
  async restore(saved: unknown): Promise<void> {
    this.reset();
    const edits = readSavedEdits(saved);
    if (!edits) return;
    const known = new Set<string>();
    for (const [edit, tally] of Object.entries(edits.tallies)) {
      this.ownEdits.add(edit);
      if (this.tallies.has(edit)) known.add(edit);
      else this.tallies.set(edit, { ...tally });
    }
    const hunks =
      edits.pending?.hunks.filter((hunk) => !known.has(hunk.edit)) ?? [];
    if (!edits.pending || hunks.length === 0) {
      this.notify();
      return;
    }
    const pending = { text: edits.pending.text, hunks };
    this.waiting = pending;
    const restore = this.restores;
    await this.host.editor.whenReady();
    if (restore !== this.restores) return;
    this.waiting = null;
    this.putBack(pending);
  }

  private putBack(pending: NonNullable<SavedEdits['pending']>) {
    const { editor } = this.host;
    const view = editor.getView();
    const shown = new Set<SavedHunk>();
    if (
      view &&
      !view.isDestroyed &&
      editor.serializeDoc(view.state.doc) === pending.text
    ) {
      const { doc, schema } = view.state;
      const present = this.pending();
      const hunks: Hunk[] = [];
      let end = 0;
      const ordered = [...pending.hunks].sort((a, b) => a.from - b.from);
      for (const saved of ordered) {
        if (saved.from < end) continue;
        // Up against a change shown already, which of the two goes first
        // is no longer known.
        if (
          present.some(
            (other) => saved.from <= other.to && other.from <= saved.to
          )
        ) {
          continue;
        }
        let insert: Slice;
        let base: Fragment;
        try {
          insert = Slice.fromJSON(schema, saved.insert as never);
          base = Fragment.fromJSON(schema, saved.base as never);
        } catch {
          continue;
        }
        const content = hunkContent(doc, saved.from, saved.to, saved.kind);
        if (!content || !fragmentsMatch(content, base)) continue;
        hunks.push({
          id: ++this.hunkIds,
          edit: saved.edit,
          from: saved.from,
          to: saved.to,
          insert,
          base,
          kind: saved.kind,
        });
        shown.add(saved);
        end = saved.to;
      }
      if (hunks.length) {
        const meta: ProposalMeta = {
          type: 'set',
          hunks: [...present, ...hunks],
        };
        view.dispatch(view.state.tr.setMeta(proposalKey, meta));
      }
    }
    for (const saved of pending.hunks) {
      if (shown.has(saved)) continue;
      const tally = this.tallies.get(saved.edit);
      if (tally) tally.dropped++;
    }
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** The pending hunks, in document order. */
  pending(): readonly Hunk[] {
    return this.state()?.hunks ?? [];
  }

  outcome(edit: string): EditOutcome | null {
    const tally = this.tallies.get(edit);
    if (!tally) return null;
    const pending = this.pending().filter((hunk) => hunk.edit === edit).length;
    return { ...tally, pending };
  }

  /**
   * The document as the assistant reads it: Markdown with the pending
   * proposals in it, and the selection in that text.
   */
  async read(): Promise<DocumentSnapshot> {
    const shown = await this.shown();
    if (!shown)
      return { text: this.host.editor.getMarkdown(), selection: null };
    const { doc, text, from, to } = shown;
    this.lastText = text;
    if (from >= to) return { text, selection: null };
    const spans = this.host.editor.blockSpans(text);
    // As when entering source mode: the text the selection covers, none of
    // the markup around it.
    const start = sourceOffset(doc, from, text, spans, 1);
    const end = Math.max(start, sourceOffset(doc, to, text, spans, -1));
    return { text, selection: start < end ? { from: start, to: end } : null };
  }

  /**
   * Where the selection and the caret are in the document as the assistant
   * reads it, for a command of the AI or the slash menu. The selection takes
   * in the markup it cuts through, so what replaces it is whole Markdown.
   */
  async placement(): Promise<Placement> {
    const { editor } = this.host;
    const shown = await this.shown();
    if (!shown) {
      const text = editor.getMarkdown();
      const end = text.length;
      return {
        text,
        selection: null,
        caret: end,
        block: { from: end, to: end, empty: true },
        kept: null,
      };
    }
    const { view, range } = shown;
    const kept = keepPlace(view, range.from, range.to);
    return { ...this.placeIn(shown), kept };
  }

  /**
   * Puts the reply to a command of the AI or slash menu in where `before`
   * was taken, the user's edits since followed.
   */
  placeReply(
    before: Placement,
    landing: Landing,
    reply: string
  ): Promise<EditResult> {
    return this.edit(() => {
      const view = this.host.editor.getView();
      const range =
        view && before.kept != null ? keptPlace(view.state, before.kept) : null;
      if (!view || !range) {
        throw new EditError(
          'not_found',
          'The text changed where the reply was to go.'
        );
      }
      const now = this.placeIn(this.shownAt(view.state, range));
      return quickEdit(before, { ...now, kept: before.kept }, landing, reply);
    }, false);
  }

  /** Lets go of the place `placement` kept. */
  forget(placement: Placement) {
    const view = this.host.editor.getView();
    if (view && !view.isDestroyed && placement.kept != null) {
      dropPlace(view, placement.kept);
    }
  }

  /** The selection and the caret's block in `shown`'s text. */
  private placeIn(shown: {
    doc: ProseNode;
    text: string;
    from: number;
    to: number;
  }): Omit<Placement, 'kept'> {
    const { doc, text, from, to } = shown;
    const spans = this.host.editor.blockSpans(text);
    let selection: Placement['selection'] = null;
    if (from < to) {
      const start = sourceOffset(doc, from, text, spans, 1);
      const end = Math.max(start, sourceOffset(doc, to, text, spans, -1));
      if (start < end) {
        const covered = doc.textBetween(from, to, '', leafText);
        const read = this.host.editor.parseMarkdown(text.slice(start, end));
        selection =
          read && bare(read.textContent) === bare(covered)
            ? { from: start, to: end }
            : wholeBlocks(doc, from, to, spans, start, end);
      }
    }
    const index = doc.resolve(to).index(0);
    const span = spans[index];
    const node = index < doc.childCount ? doc.child(index) : null;
    // The empty paragraph the editor keeps at the end is not in the text.
    const block =
      span && node
        ? {
            from: span.from,
            to: span.to,
            empty: node.type.name === 'paragraph' && node.content.size === 0,
          }
        : { from: text.length, to: text.length, empty: true };
    return {
      text,
      selection,
      caret: sourceOffset(doc, to, text, spans, -1),
      block,
    };
  }

  /** The document with its proposals in, and the selection in it. */
  private async shown() {
    const { editor } = this.host;
    await editor.whenReady();
    const inSource = this.host.sourceSelection();
    const view = editor.getView();
    if (!view) return null;
    const { from, to } = inSource ?? view.state.selection;
    const range = { from, to };
    return { ...this.shownAt(view.state, range), view, range };
  }

  /** The document of `state` with its proposals in, and `range` in it. */
  private shownAt(state: EditorState, range: { from: number; to: number }) {
    const { editor } = this.host;
    const hunks = proposalState(state)?.hunks ?? [];
    const shown = hunks.length ? applyHunks(state.doc, hunks) : null;
    const doc = shown?.doc ?? state.doc;
    const text = editor.serializeDoc(doc);
    const from = shown ? shown.mapping.map(range.from, 1) : range.from;
    const to = shown ? shown.mapping.map(range.to, -1) : range.to;
    return { doc, text, from, to };
  }

  /**
   * What happened to this conversation's edits since the assistant was last
   * told, and where the text changed since it last saw it.
   */
  async notices(): Promise<string | null> {
    const { editor } = this.host;
    await editor.whenReady();
    this.host.flushSource();
    const state = this.state();
    const events = (state?.events ?? []).filter(
      (event) => event.seq > this.seenSeq && this.ownEdits.has(event.hunk.edit)
    );
    if (state) this.seenSeq = state.seq;
    const text = this.viewText();
    const changed =
      this.lastText != null && text != null && text !== this.lastText
        ? changedLines(this.lastText, text)
        : null;
    if (text != null) this.lastText = text;
    return noticeText(events, changed);
  }

  /**
   * Makes the edit `make` gives on the document as the assistant reads it.
   * Throws an `EditError` when it cannot be made. An edit not `own` comes
   * from a command of the AI or the slash menu: the conversation's assistant
   * is told neither of it nor, with it, of what it has yet to hear.
   */
  async edit(
    make: (text: string) => TextEdit,
    own = true
  ): Promise<EditResult> {
    const { editor } = this.host;
    let notices: string | null = null;
    if (own) notices = await this.notices();
    else {
      await editor.whenReady();
      this.host.flushSource();
    }
    const view = editor.getView();
    if (!view) {
      throw new EditError(
        'not_ready',
        'The editor is still opening; try again.'
      );
    }
    const env: EditEnv = {
      parse: (markdown) => editor.parseMarkdown(markdown),
      serialize: (doc) => editor.serializeDoc(doc),
      blockSpans: (markdown) => editor.blockSpans(markdown),
    };
    const pending = proposalState(view.state)?.hunks ?? [];
    let proposed: ReturnType<typeof proposeEdit>;
    try {
      proposed = proposeEdit(env, view.state.doc, pending, make);
    } catch (error) {
      // The notices are told once; with a failed edit, they go with it.
      if (error instanceof EditError && notices) {
        throw new EditError(error.code, `${error.message}\n\n${notices}`);
      }
      throw error;
    }

    const { editTag } = this.host;
    const edit = editTag ? `e${++this.edits}-${editTag}` : `e${++this.edits}`;
    const hunks: Hunk[] = proposed.hunks.map((draft) => ({
      id: ++this.hunkIds,
      edit,
      from: draft.from,
      to: draft.to,
      insert: new Slice(draft.insert, 0, 0),
      base: draft.base,
      kind: draft.kind,
    }));
    const dropped = new Set(proposed.dropped);
    for (const hunk of pending) {
      const tally = dropped.has(hunk.id) && this.tallies.get(hunk.edit);
      if (tally) tally.replaced++;
    }
    this.tallies.set(edit, {
      total: hunks.length,
      accepted: 0,
      rejected: 0,
      dropped: 0,
      replaced: 0,
    });
    if (own) this.ownEdits.add(edit);
    const meta: ProposalMeta = {
      type: 'set',
      hunks: [...pending.filter((hunk) => !dropped.has(hunk.id)), ...hunks],
    };
    view.dispatch(view.state.tr.setMeta(proposalKey, meta));

    const auto = this.host.editMode() === 'auto' && hunks.length > 0;
    if (auto) this.accept(hunks.map((hunk) => hunk.id));
    if (own) {
      // What the edit did itself is no news to the assistant.
      this.seenSeq = this.state()?.seq ?? this.seenSeq;
      this.lastText = proposed.after;
    }
    return {
      report: editReport({
        status: auto ? 'applied' : 'proposed',
        edit,
        changes: hunks.length,
        withdrawn: dropped.size,
        before: proposed.before,
        after: proposed.after,
        intended: proposed.intended,
      }),
      notices,
    };
  }

  /** Accepts the hunks `ids`, all when left out, as one undo step. */
  accept(ids?: readonly number[]) {
    const view = this.host.editor.getView();
    if (!view || view.isDestroyed) return;
    // Mid-composition the text is the input method's; once it is done.
    if (view.composing) {
      view.dom.addEventListener(
        'compositionend',
        () => window.setTimeout(() => this.accept(ids)),
        { once: true }
      );
      return;
    }
    this.host.flushSource();
    const before = view.state.doc;
    acceptHunks(view, ids);
    if (view.state.doc !== before) this.host.followSource(before);
  }

  /** Rejects the hunks `ids`, all when left out. */
  reject(ids?: readonly number[]) {
    const view = this.host.editor.getView();
    if (view && !view.isDestroyed) rejectHunks(view, ids);
  }

  acceptEdit(edit: string) {
    const ids = this.idsOf(edit);
    if (ids.length) this.accept(ids);
  }

  rejectEdit(edit: string) {
    const ids = this.idsOf(edit);
    if (ids.length) this.reject(ids);
  }

  /** Scrolls to the first pending change of `edit`, or of any edit. */
  revealEdit(edit?: string) {
    const hunk = this.pending().find((each) => !edit || each.edit === edit);
    if (hunk) this.reveal(hunk.id);
  }

  /** Steps to the next pending change, or back to the one before. */
  step(direction: 1 | -1) {
    const hunks = this.pending();
    if (hunks.length === 0) return;
    const at = hunks.findIndex((hunk) => hunk.id === this.current);
    const next =
      at < 0
        ? direction > 0
          ? 0
          : hunks.length - 1
        : (at + direction + hunks.length) % hunks.length;
    this.reveal(hunks[next].id);
  }

  /** Where the current change is among the pending ones, from 1; 0 for none. */
  position(): number {
    return this.pending().findIndex((hunk) => hunk.id === this.current) + 1;
  }

  private reveal(id: number) {
    const view = this.host.editor.getView();
    if (!view) return;
    this.current = id;
    const marked = view.dom.querySelectorAll<HTMLElement>(
      `[data-ny-hunk="${id}"]`
    );
    const first = marked[0];
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else this.scrollToPos(view, id);
    for (const element of view.dom.querySelectorAll('.is-current')) {
      if (element.hasAttribute('data-ny-hunk')) {
        element.classList.remove('is-current');
      }
    }
    for (const element of marked) element.classList.add('is-current');
    if (this.markTimer != null) window.clearTimeout(this.markTimer);
    this.markTimer = window.setTimeout(() => {
      for (const element of marked) element.classList.remove('is-current');
    }, MARK_MS);
    this.notify();
  }

  private scrollToPos(view: EditorView, id: number) {
    const hunk = this.pending().find((each) => each.id === id);
    if (!hunk) return;
    const { node } = view.domAtPos(hunk.from);
    const element = node instanceof Element ? node : node.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private idsOf(edit: string) {
    return this.pending()
      .filter((hunk) => hunk.edit === edit)
      .map((hunk) => hunk.id);
  }

  private state() {
    const view = this.host.editor.getView();
    return view ? proposalState(view.state) : undefined;
  }

  /** The text with its proposals, as `read` gives it, without the waiting. */
  private viewText(): string | null {
    const { editor } = this.host;
    const view = editor.getView();
    if (!view) return null;
    const hunks = proposalState(view.state)?.hunks ?? [];
    const shown = hunks.length ? applyHunks(view.state.doc, hunks) : null;
    return shown ? editor.serializeDoc(shown.doc) : editor.getMarkdown();
  }

  private changed() {
    const state = this.state();
    if (state) {
      for (const event of state.events) {
        if (event.seq <= this.countedSeq) continue;
        const tally = this.tallies.get(event.hunk.edit);
        if (!tally) continue;
        if (event.kind === 'accepted') tally.accepted++;
        else if (event.kind === 'rejected') tally.rejected++;
        else if (event.kind === 'restored') tally.accepted--;
        else tally.dropped++;
      }
      this.countedSeq = state.seq;
      if (!state.hunks.some((hunk) => hunk.id === this.current)) {
        this.current = null;
      }
    }
    this.notify();
  }
}
