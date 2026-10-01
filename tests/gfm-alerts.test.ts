import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, type Transaction } from '@milkdown/kit/prose/state';
import type { DecorationSet } from '@milkdown/kit/prose/view';
import {
  buildDecorations,
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
