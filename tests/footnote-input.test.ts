import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  DEFINITION,
  REFERENCE,
  footnoteToText,
  typedDefinition,
  typedReference,
} from '../src/editor/plugins/footnote-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    footnote_definition: {
      group: 'block',
      content: 'block+',
      attrs: { label: { default: '' } },
    },
    footnote_reference: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { label: { default: '' } },
    },
    text: { group: 'inline' },
  },
});

const p = (...content: (string | Node)[]) =>
  schema.node(
    'paragraph',
    null,
    content.map((c) => (typeof c === 'string' ? schema.text(c) : c))
  );
const ref = (label: string) => schema.node('footnote_reference', { label });
const note = (label: string, ...blocks: Node[]) =>
  schema.node('footnote_definition', { label }, blocks);
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** `typed` typed at the end of the text before the caret, at `pos`. */
function type(
  start: Node,
  pos: number,
  typed: string,
  pattern: RegExp,
  rule: typeof typedReference
) {
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, pos),
  });
  const { $from } = state.selection;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    '￼'
  );
  const match = (before + typed).match(pattern);
  if (!match) return null;
  const from = pos - (match[0].length - typed.length);
  const tr = rule(state, match, from, pos);
  return tr && { doc: tr.doc, head: tr.selection.$head };
}

describe('`[^1]` typed into a line', () => {
  test('becomes the mark of footnote 1', () => {
    const out = type(doc(p('a[^1')), 5, ']', REFERENCE, typedReference);
    expect(out?.doc.eq(doc(p('a', ref('1'))))).toBe(true);
  });

  test('stays text after a backslash', () => {
    expect(type(doc(p('a\\[^1')), 6, ']', REFERENCE, typedReference)).toBe(
      null
    );
  });
  test('stays text across a line break or image', () => {
    expect(REFERENCE.exec('a[^1\ufffc2]')).toBeNull();
  });
});

describe('`[^1]: ` typed at the start of a line', () => {
  test('makes the line footnote 1, the caret at its text', () => {
    const out = type(doc(p('[^1]:ab')), 6, ' ', DEFINITION, typedDefinition);
    expect(out?.doc.eq(doc(note('1', p('ab'))))).toBe(true);
    expect(out?.head.parentOffset).toBe(0);
  });

  test('after the mark already made of `[^1]`', () => {
    const out = type(
      doc(p(ref('1'), ':')),
      3,
      ' ',
      DEFINITION,
      typedDefinition
    );
    expect(out?.doc.eq(doc(note('1', p())))).toBe(true);
  });

  test('on a line under a footnote, starts the next one there', () => {
    const out = type(
      doc(note('1', p('a'), p('[^2]:b'), p('c'))),
      10,
      ' ',
      DEFINITION,
      typedDefinition
    );
    expect(out?.doc.eq(doc(note('1', p('a')), note('2', p('b'), p('c'))))).toBe(
      true
    );
    expect(out?.head.pos).toBe(7);
    const marked = type(
      doc(note('1', p('a')), note('1', p('a'), p(ref('2'), ':'))),
      12,
      ' ',
      DEFINITION,
      typedDefinition
    );
    expect(
      marked?.doc.eq(doc(note('1', p('a')), note('1', p('a')), note('2', p())))
    ).toBe(true);
  });

  test('is left alone on the first line of a footnote', () => {
    expect(
      type(doc(note('1', p('[^2]:'))), 7, ' ', DEFINITION, typedDefinition)
    ).toBe(null);
  });

  test('is left alone in a quote', () => {
    expect(
      type(doc(quote(p('[^1]:'))), 7, ' ', DEFINITION, typedDefinition)
    ).toBe(null);
  });
});

describe('Backspace at the start of a footnote', () => {
  test('turns it back into `[^1]:` and its text', () => {
    const start = doc(p('a'), note('1', p('b'), p('c')));
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, 5),
    });
    const tr = footnoteToText(state);
    expect(tr?.doc.eq(doc(p('a'), p('[^1]:b'), p('c')))).toBe(true);
    expect(tr?.selection.$head.parentOffset).toBe(5);
  });

  test('is left alone further in', () => {
    const start = doc(note('1', p('b'), p('c')));
    const state = EditorState.create({
      doc: start,
      selection: TextSelection.create(start, 5),
    });
    expect(footnoteToText(state)).toBe(null);
  });
});
