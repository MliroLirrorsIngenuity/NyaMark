import { describe, expect, test } from 'bun:test';
import { history, redo, undo, undoDepth } from '@milkdown/kit/prose/history';
import { Fragment, type Node, Slice } from '@milkdown/kit/prose/model';
import { EditorState, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  type Hunk,
  ORIGIN_META,
  type ProposalMeta,
  acceptHunks,
  hunkContent,
  proposalKey,
  proposalsPlugin,
  rejectHunks,
} from '../src/editor/plugins/ai-proposals';
import { doc, inline, p, schema, serialize } from './ai-edit-helpers';

type FakeView = {
  state: EditorState;
  composing: boolean;
  isDestroyed: boolean;
  dom: EventTarget;
  dispatch(tr: Transaction): void;
};

function viewOf(start: Node) {
  const view: FakeView = {
    state: EditorState.create({
      doc: start,
      plugins: [history(), proposalsPlugin()],
    }),
    composing: false,
    isDestroyed: false,
    dom: new EventTarget(),
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

const asView = (view: FakeView) => view as unknown as EditorView;

/** Where `text` starts in `node`'s text. */
function at(node: Node, text: string) {
  let found = -1;
  node.descendants((child, pos) => {
    const index = child.isText ? (child.text ?? '').indexOf(text) : -1;
    if (found < 0 && index >= 0) found = pos + index;
    return found < 0;
  });
  if (found < 0) throw new Error(`no ${text}`);
  return found;
}

let nextId = 1;

function hunk(
  view: FakeView,
  from: number,
  to: number,
  insert: Node[],
  kind: Hunk['kind'] = 'inline'
): Hunk {
  const base = hunkContent(view.state.doc, from, to, kind);
  if (!base) throw new Error('not a hunk');
  return {
    id: nextId++,
    edit: 'e1',
    from,
    to,
    insert: new Slice(Fragment.fromArray(insert), 0, 0),
    base,
    kind,
  };
}

/** The word `word` proposed as `next`. */
const word = (view: FakeView, text: string, next: string) => {
  const from = at(view.state.doc, text);
  return hunk(view, from, from + text.length, inline(next));
};

function propose(view: FakeView, hunks: Hunk[]) {
  const meta: ProposalMeta = { type: 'set', hunks };
  view.dispatch(view.state.tr.setMeta(proposalKey, meta));
}

const state = (view: FakeView) => {
  const value = proposalKey.getState(view.state);
  if (!value) throw new Error('no plugin');
  return value;
};
const pending = (view: FakeView) => state(view).hunks.map((h) => h.id);
const events = (view: FakeView, since = 0) =>
  state(view)
    .events.filter((event) => event.seq > since)
    .map((event) =>
      event.reason ? `${event.kind}:${event.reason}` : event.kind
    );
const text = (view: FakeView) => serialize(view.state.doc);
const type = (view: FakeView, pos: number, typed: string) =>
  view.dispatch(view.state.tr.insertText(typed, pos));

describe('proposals', () => {
  test('are no part of the document', () => {
    const view = viewOf(doc(p('one two three')));
    const before = view.state.doc;
    propose(view, [word(view, 'two', 'TWO')]);
    expect(view.state.doc).toBe(before);
    expect(undoDepth(view.state)).toBe(0);
    expect(state(view).decorations.find()).toHaveLength(2);
  });

  test('are accepted as one undo step, undone back to proposals', () => {
    const view = viewOf(doc(p('one two three')));
    const size = view.state.doc.content.size;
    const a = word(view, 'two', 'TWO');
    const b = word(view, 'three', 'THREE');
    const c = hunk(view, size, size, [p('four')], 'block');
    propose(view, [a, b, c]);
    acceptHunks(asView(view));
    expect(text(view)).toBe('one TWO THREE\n\nfour\n');
    expect(pending(view)).toEqual([]);
    expect(events(view)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(undoDepth(view.state)).toBe(1);

    let seq = state(view).seq;
    undo(view.state, view.dispatch);
    expect(text(view)).toBe('one two three\n');
    expect(pending(view).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(events(view, seq)).toEqual(['restored', 'restored', 'restored']);
    for (const hunk of state(view).hunks) {
      expect(
        hunkContent(view.state.doc, hunk.from, hunk.to, hunk.kind)?.eq(
          hunk.base
        )
      ).toBe(true);
    }

    seq = state(view).seq;
    redo(view.state, view.dispatch);
    expect(text(view)).toBe('one TWO THREE\n\nfour\n');
    expect(pending(view)).toEqual([]);
    expect(events(view, seq)).toEqual(['accepted', 'accepted', 'accepted']);
  });

  test('accept those picked and leave the rest', () => {
    const view = viewOf(doc(p('one two three')));
    const a = word(view, 'one', 'ONE');
    const b = word(view, 'three', 'THREE');
    propose(view, [a, b]);
    acceptHunks(asView(view), [b.id]);
    expect(text(view)).toBe('one two THREE\n');
    expect(pending(view)).toEqual([a.id]);
    const left = state(view).hunks[0];
    expect(view.state.doc.textBetween(left.from, left.to)).toBe('one');
  });

  test('keep what is typed next out of the accept', () => {
    const view = viewOf(doc(p('one two')));
    propose(view, [word(view, 'two', 'TWO')]);
    acceptHunks(asView(view));
    type(view, view.state.doc.content.size - 1, '!');
    expect(undoDepth(view.state)).toBe(2);
    undo(view.state, view.dispatch);
    expect(text(view)).toBe('one TWO\n');
  });

  test('rejected leave the document as it is', () => {
    const view = viewOf(doc(p('one two')));
    const before = view.state.doc;
    const a = word(view, 'two', 'TWO');
    propose(view, [a]);
    rejectHunks(asView(view), [a.id]);
    expect(view.state.doc).toBe(before);
    expect(pending(view)).toEqual([]);
    expect(events(view)).toEqual(['rejected']);
    expect(undoDepth(view.state)).toBe(0);
    expect(state(view).decorations.find()).toHaveLength(0);
  });

  test('follow text typed before them and at their edges', () => {
    const view = viewOf(doc(p('one two three')));
    const a = word(view, 'two', 'TWO');
    propose(view, [a]);
    type(view, 1, 'zero ');
    type(view, at(view.state.doc, 'two'), '<');
    type(view, at(view.state.doc, 'two') + 3, '>');
    expect(text(view)).toBe('zero one <two> three\n');
    const [moved] = state(view).hunks;
    expect(moved.id).toBe(a.id);
    expect(view.state.doc.textBetween(moved.from, moved.to)).toBe('two');
    acceptHunks(asView(view));
    expect(text(view)).toBe('zero one <TWO> three\n');
  });

  test('typed into are dropped as a conflict', () => {
    const view = viewOf(doc(p('one two three')));
    propose(view, [word(view, 'two', 'TWO'), word(view, 'one', 'ONE')]);
    type(view, at(view.state.doc, 'two') + 1, 'x');
    expect(state(view).hunks).toHaveLength(1);
    expect(events(view)).toEqual(['conflict:edited']);
  });

  test('deleted across are dropped as a conflict', () => {
    const view = viewOf(doc(p('one two three')));
    propose(view, [word(view, 'two', 'TWO')]);
    const from = at(view.state.doc, 'one') + 2;
    view.dispatch(view.state.tr.delete(from, from + 4));
    expect(pending(view)).toEqual([]);
    expect(events(view)).toEqual(['conflict:edited']);
  });

  test('typed by hand are taken as accepted', () => {
    const view = viewOf(doc(p('one two')));
    propose(view, [word(view, 'two', 'TWO')]);
    const from = at(view.state.doc, 'two');
    view.dispatch(view.state.tr.insertText('TWO', from, from + 3));
    expect(pending(view)).toEqual([]);
    expect(events(view)).toEqual(['accepted']);
  });

  test('changed by a reload are dropped for it, the rest kept', () => {
    const view = viewOf(doc(p('one'), p('two')));
    const a = word(view, 'one', 'ONE');
    const b = word(view, 'two', 'TWO');
    propose(view, [a, b]);
    const from = at(view.state.doc, 'two');
    view.dispatch(
      view.state.tr
        .insertText('2', from, from + 3)
        .setMeta(ORIGIN_META, 'reload')
    );
    expect(pending(view)).toEqual([a.id]);
    expect(events(view)).toEqual(['conflict:reload']);
  });

  test('that no longer fit are dropped when accepted', () => {
    const view = viewOf(doc(p('one'), p('two')));
    const end = view.state.doc.content.size;
    const item = schema.node('list_item', null, [p('x')]);
    const bad = hunk(view, end, end, [item], 'block');
    const good = word(view, 'one', 'ONE');
    propose(view, [bad, good]);
    acceptHunks(asView(view));
    expect(text(view)).toBe('ONE\n\ntwo\n');
    expect(pending(view)).toEqual([]);
    expect(events(view).sort()).toEqual(['accepted', 'conflict:invalid']);

    const alone = viewOf(doc(p('one')));
    const size = alone.state.doc.content.size;
    propose(alone, [hunk(alone, size, size, [item], 'block')]);
    acceptHunks(asView(alone));
    expect(text(alone)).toBe('one\n');
    expect(pending(alone)).toEqual([]);
    expect(events(alone)).toEqual(['conflict:invalid']);
  });

  test('wait for an input method to finish before an accept', async () => {
    const view = viewOf(doc(p('one two')));
    propose(view, [word(view, 'two', 'TWO')]);
    view.composing = true;
    acceptHunks(asView(view));
    expect(text(view)).toBe('one two\n');
    view.composing = false;
    view.dom.dispatchEvent(new Event('compositionend'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(text(view)).toBe('one TWO\n');
  });

  test('are cleared all at once', () => {
    const view = viewOf(doc(p('one two')));
    propose(view, [word(view, 'two', 'TWO')]);
    const meta: ProposalMeta = { type: 'clear' };
    view.dispatch(view.state.tr.setMeta(proposalKey, meta));
    expect(pending(view)).toEqual([]);
    expect(events(view)).toEqual([]);
  });
});
