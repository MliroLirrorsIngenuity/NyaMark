/**
 * The assistant's edits to the open document: read with its proposals in
 * it, made into proposals (or applied right away, as the settings say),
 * accepted and rejected from the document or the panel, and told back to the
 * assistant as they are taken or turned down.
 */

import { type Node as ProseNode, Slice } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { NyaEditor } from '../../editor/editor';
import {
  type Hunk,
  type ProposalMeta,
  acceptHunks,
  onProposalsChange,
  proposalKey,
  proposalState,
  rejectHunks,
  setHunkRenderer,
} from '../../editor/plugins/ai-proposals';
import { sourceOffset } from '../../editor/source-caret';
import type { AiEditMode } from '../../state/ai-settings';
import type { DocumentSnapshot } from '../agent/document-text';
import { type EditEnv, applyHunks, proposeEdit } from './propose';
import { renderHunk } from './render';
import {
  type EditReport,
  changedLines,
  editReport,
  noticeText,
} from './report';
import { EditError, type TextEdit } from './text-edit';

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
};

/** What became of an edit's changes. */
export type EditOutcome = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  /** Dropped as the user changed their text, a reload did, or no fit. */
  dropped: number;
  /** Taken back or redone by a later edit of the assistant's. */
  replaced: number;
};

type Tally = Omit<EditOutcome, 'pending'>;

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
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly host: EditHost) {
    setHunkRenderer((view, hunk) =>
      renderHunk(view, hunk, {
        accept: (id) => this.accept([id]),
        reject: (id) => this.reject([id]),
        imageSource: (src) => host.editor.imageSource(src),
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
    const { editor } = this.host;
    await editor.whenReady();
    const inSource = this.host.sourceSelection();
    const view = editor.getView();
    if (!view) return { text: editor.getMarkdown(), selection: null };
    const hunks = proposalState(view.state)?.hunks ?? [];
    const shown = hunks.length ? applyHunks(view.state.doc, hunks) : null;
    const doc = shown?.doc ?? view.state.doc;
    const text = shown ? editor.serializeDoc(doc) : editor.getMarkdown();
    this.lastText = text;
    const selection = inSource ?? view.state.selection;
    const from = shown ? shown.mapping.map(selection.from, 1) : selection.from;
    const to = shown ? shown.mapping.map(selection.to, -1) : selection.to;
    if (from >= to) return { text, selection: null };
    const spans = editor.blockSpans(text);
    // As when entering source mode: the text the selection covers, none of
    // the markup around it.
    const start = sourceOffset(doc, from, text, spans, 1);
    const end = Math.max(start, sourceOffset(doc, to, text, spans, -1));
    return { text, selection: start < end ? { from: start, to: end } : null };
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
   * Throws an `EditError` when it cannot be made.
   */
  async edit(make: (text: string) => TextEdit): Promise<EditResult> {
    const { editor } = this.host;
    const notices = await this.notices();
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

    const edit = `e${++this.edits}`;
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
    this.ownEdits.add(edit);
    const meta: ProposalMeta = {
      type: 'set',
      hunks: [...pending.filter((hunk) => !dropped.has(hunk.id)), ...hunks],
    };
    view.dispatch(view.state.tr.setMeta(proposalKey, meta));

    const auto = this.host.editMode() === 'auto' && hunks.length > 0;
    if (auto) this.accept(hunks.map((hunk) => hunk.id));
    // What the edit did itself is no news to the assistant.
    this.seenSeq = this.state()?.seq ?? this.seenSeq;
    this.lastText = proposed.after;
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
    for (const listener of this.listeners) listener();
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
    for (const listener of this.listeners) listener();
  }
}
