import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { liftEmptyQuoteLine } from '../src/editor/plugins/quote-enter';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** Enter with the caret at `pos`. */
const enterAt = (start: Node, pos: number) =>
  liftEmptyQuoteLine(
    EditorState.create({
      doc: start,
      selection: TextSelection.create(start, pos),
    })
  );

describe('an empty line of a quote', () => {
  test('leaves the quote from the middle of it', () => {
    // The quote opens at 0, "a" at 2, and the empty line at 4: inside it, 5.
    const tr = enterAt(doc(quote(p('a'), p(''), p('b'))), 5);
    expect(tr?.doc.toJSON()).toEqual(
      doc(quote(p('a')), p(''), quote(p('b'))).toJSON()
    );
    expect(tr?.selection.$from.depth).toBe(1);
  });

  test('leaves from the top of it', () => {
    expect(enterAt(doc(quote(p(''), p('b'))), 2)?.doc.toJSON()).toEqual(
      doc(p(''), quote(p('b'))).toJSON()
    );
  });

  test('is left to the usual Enter at the end, or with text in it', () => {
    expect(enterAt(doc(quote(p('a'), p(''))), 5)).toBeNull();
    expect(enterAt(doc(quote(p('a'), p('b'))), 3)).toBeNull();
  });
});
