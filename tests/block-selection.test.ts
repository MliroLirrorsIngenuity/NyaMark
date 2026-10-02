import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { coveredChips } from '../src/editor/plugins/block-selection';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    code: { code: true },
  },
});

const code = [schema.mark('code')];

// "fix " then `parser` (5 to 11) then " bug", and `ok` (16 to 18) ending it.
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [
    schema.text('fix '),
    schema.text('parser', code),
    schema.text(' bug '),
    schema.text('ok', code),
  ]),
]);

const selected = (from: number, to: number) =>
  coveredChips(
    EditorState.create({
      doc,
      selection: TextSelection.create(doc, from, to),
    })
  );

describe('pieces of code in a line under a selection', () => {
  test('are the ones it takes whole, one ending the line among them', () => {
    expect(selected(1, 18)).toEqual([
      [5, 11],
      [16, 18],
    ]);
    expect(selected(5, 11)).toEqual([[5, 11]]);
  });

  test('leave out one it runs into', () => {
    expect(selected(1, 8)).toEqual([]);
    expect(selected(7, 18)).toEqual([[16, 18]]);
  });

  test('are none for a caret', () => {
    expect(selected(6, 6)).toEqual([]);
  });
});
