import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { dropLeftLines, plusLinesAfter } from '../src/editor/plugins/plus-line';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    heading: { group: 'block', content: 'text*' },
    text: {},
  },
});

// "ab" at 0-4, then the "+" puts an empty line in at 4.
const start = EditorState.create({
  doc: schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('ab')]),
    schema.node('paragraph', null, [schema.text('cd')]),
  ]),
});

function plus() {
  const tr = start.tr.insert(4, schema.node('paragraph'));
  tr.setSelection(TextSelection.create(tr.doc, 5));
  const state = start.apply(tr);
  return { state, lines: plusLinesAfter([], tr, state, true) };
}

describe('the line the "+" puts in', () => {
  test('is followed from the press that put it in', () => {
    expect(plus().lines).toEqual([4]);
  });

  test('stays while the caret is on it', () => {
    const { state, lines } = plus();
    expect(dropLeftLines(state, lines)).toBeNull();
  });

  test('goes when the caret leaves it empty', () => {
    const { state, lines } = plus();
    const moved = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2))
    );
    const tr = dropLeftLines(moved, lines);
    expect(tr?.doc.toString()).toBe(start.doc.toString());
    expect(tr?.selection.from).toBe(2);
  });

  test('is the document’s once typed in or made another block', () => {
    const { state, lines } = plus();
    const typed = state.tr.insertText('x', 5);
    expect(plusLinesAfter(lines, typed, state.apply(typed), false)).toEqual([]);
    const heading = state.tr.setBlockType(5, 5, schema.nodes.heading);
    expect(plusLinesAfter(lines, heading, state.apply(heading), false)).toEqual(
      []
    );
  });

  test('moves with what is put in above it', () => {
    const { state, lines } = plus();
    const tr = state.tr.insertText('zz', 1);
    expect(plusLinesAfter(lines, tr, state.apply(tr), false)).toEqual([6]);
  });
});
