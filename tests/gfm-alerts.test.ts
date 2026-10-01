import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { DecorationSet } from '@milkdown/kit/prose/view';
import {
  buildDecorations,
  keepCaretOutOfMarker,
  removeMarkerOnBackspace,
  updateDecorations,
} from '../src/editor/plugins/gfm-alerts';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
    hardbreak: { group: 'inline', inline: true },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

function describeSet(set: DecorationSet, at: Node) {
  return set
    .find(0, at.content.size)
    .map((d) => `${d.from}-${d.to}:${JSON.stringify(d.spec)}`)
    .concat(
      set
        .find(0, at.content.size)
        .map((d) => JSON.stringify((d as unknown as { type: unknown }).type))
    )
    .sort();
}

function expectIncrementalMatchesFull(
  start: Node,
  edit: (tr: Transaction) => void
) {
  const state = EditorState.create({ doc: start });
  const tr = state.tr;
  edit(tr);
  const incremental = updateDecorations(tr, buildDecorations(start));
  const full = buildDecorations(tr.doc);
  expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full, tr.doc));
  return full.find().length;
}

const start = () =>
  doc(
    p('intro'),
    quote(p('[!NOTE]'), p('body')),
    quote(p('plain quote')),
    p('outro')
  );

describe('gfm alert decorations', () => {
  test('finds alerts in a fresh document', () => {
    expect(buildDecorations(start()).find().length).toBe(3);
  });

  test('typing inside an alert keeps it', () => {
    const count = expectIncrementalMatchesFull(start(), (tr) =>
      tr.insertText('more ', 18)
    );
    expect(count).toBe(3);
  });

  test('turning a plain quote into an alert adds one', () => {
    const at = start().child(0).nodeSize + start().child(1).nodeSize + 2;
    const count = expectIncrementalMatchesFull(start(), (tr) =>
      tr.insertText('[!TIP]', at, at + 'plain quote'.length)
    );
    expect(count).toBe(6);
  });

  test('breaking a marker removes the alert', () => {
    const count = expectIncrementalMatchesFull(start(), (tr) =>
      tr.delete(10, 11)
    );
    expect(count).toBe(0);
  });

  test('editing a neighbouring block leaves the alert alone', () => {
    const count = expectIncrementalMatchesFull(start(), (tr) =>
      tr.insertText('!', 2)
    );
    expect(count).toBe(3);
  });

  test('several steps in one transaction', () => {
    expectIncrementalMatchesFull(start(), (tr) => {
      tr.insertText('x', 1);
      tr.delete(0, tr.doc.child(0).nodeSize);
      tr.insert(tr.doc.content.size, quote(p('[!WARNING]'), p('careful')));
    });
  });
});

describe('the caret around a hidden marker', () => {
  // intro: 0-7, quote at 7, paragraph at 8, marker 9-17, body from 17.
  const inline = () => doc(p('intro'), quote(p('[!NOTE]\nbody')), p('outro'));
  // The marker fills paragraph 8-17; the body text starts at 18.
  const ownLine = () =>
    doc(p('intro'), quote(p('[!NOTE]'), p('body')), p('outro'));

  function moveCaret(start: Node, from: number, to: number) {
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, from),
    });
    const tr = state.tr.setSelection(TextSelection.create(start, to));
    const fix = keepCaretOutOfMarker([tr], state, state.apply(tr));
    return fix ? fix.selection.head : to;
  }

  test('a caret entering the marker moves on to the body', () => {
    expect(moveCaret(inline(), 6, 9)).toBe(17);
    expect(moveCaret(inline(), 6, 12)).toBe(17);
    expect(moveCaret(ownLine(), 6, 9)).toBe(18);
  });

  test('a caret leaving the body backwards skips the marker', () => {
    expect(moveCaret(inline(), 17, 16)).toBe(6);
    expect(moveCaret(ownLine(), 18, 16)).toBe(6);
  });

  test('a caret in the body or outside the alert stays put', () => {
    expect(moveCaret(inline(), 6, 17)).toBe(17);
    expect(moveCaret(inline(), 17, 19)).toBe(19);
    expect(moveCaret(inline(), 17, 3)).toBe(3);
  });

  function backspace(start: Node, at: number) {
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, at),
    });
    return removeMarkerOnBackspace(state)?.doc ?? null;
  }

  test('Backspace at the start of the body leaves a plain quote', () => {
    expect(
      backspace(inline(), 17)?.eq(doc(p('intro'), quote(p('body')), p('outro')))
    ).toBe(true);
    expect(
      backspace(ownLine(), 18)?.eq(
        doc(p('intro'), quote(p('body')), p('outro'))
      )
    ).toBe(true);
  });

  test('Backspace anywhere else is left to the editor', () => {
    expect(backspace(inline(), 18)).toBeNull();
    expect(backspace(inline(), 3)).toBeNull();
  });
});
