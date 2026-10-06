import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  HEADING_AFTER_BREAK,
  HEADING_LEVEL,
  NOT_A_HEADING,
  headingAfterBreak,
  keepHashes,
  typedHeadingLevel,
} from '../src/editor/plugins/heading-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    text: { group: 'inline' },
    hardbreak: {
      group: 'inline',
      inline: true,
      attrs: { isInline: { default: false } },
    },
  },
});

const heading = (level: number, text: string) =>
  schema.node('heading', { level }, schema.text(text));
const p = (text: string) => schema.node('paragraph', null, schema.text(text));
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

/** `typed` and a space at the start of the first block, the text already there. */
function type(start: Node, typed: string) {
  const state = EditorState.create({ doc: start });
  const withHashes = state.apply(state.tr.insertText(typed, 1));
  const match = `${typed} `.match(HEADING_LEVEL);
  if (!match) return null;
  return typedHeadingLevel(withHashes, match, 1, 1 + typed.length);
}

describe('typedHeadingLevel', () => {
  test('sets the level typed in front of a heading', () => {
    const tr = type(doc(heading(1, '标题')), '##');
    expect(tr?.doc.toJSON()).toEqual(doc(heading(2, '标题')).toJSON());
    expect(
      type(doc(heading(3, '标题')), '#')?.doc.firstChild?.attrs.level
    ).toBe(1);
  });

  test('leaves a paragraph to Milkdown', () => {
    expect(type(doc(p('正文')), '##')).toBeNull();
  });

  test('takes no more than six', () => {
    expect('####### '.match(HEADING_LEVEL)).toBeNull();
  });
});

describe('keepHashes', () => {
  test('leaves seven hashes as text', () => {
    const start = doc(p('#######'));
    const state = EditorState.create({ doc: start });
    const match = '####### '.match(NOT_A_HEADING);
    if (!match) throw new Error('no match');
    const tr = keepHashes(state, match, 1, 8);
    expect(tr.doc.toJSON()).toEqual(doc(p('####### ')).toJSON());
    expect('###### '.match(NOT_A_HEADING)).toBeNull();
  });
});

/** A paragraph of `parts`, each text or a line break (`null`). */
const lines = (...parts: (string | null)[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) =>
      part == null ? schema.node('hardbreak') : schema.text(part)
    )
  );

/** A space typed at `at` in `start`. */
function typeSpace(start: Node, at: number) {
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, at),
  });
  const before = state.doc
    .resolve(at)
    .parent.textBetween(0, at - 1, undefined, '\ufffc');
  const match = `${before} `.match(HEADING_AFTER_BREAK);
  if (!match) return null;
  return headingAfterBreak(state, match, at - (match[0].length - 1), at);
}

describe('headingAfterBreak', () => {
  test('makes a heading of the line after a break', () => {
    const start = doc(lines('升级）', null, '###解决方法', null, '需要'));
    const tr = typeSpace(start, 8);
    expect(tr?.doc.toJSON()).toEqual(
      doc(p('升级）'), heading(3, '解决方法'), p('需要')).toJSON()
    );
    expect(tr?.selection.head).toBe(6);
  });

  test('takes the line to the end of the paragraph', () => {
    const tr = typeSpace(doc(lines('前', null, '##后')), 5);
    expect(tr?.doc.toJSON()).toEqual(doc(p('前'), heading(2, '后')).toJSON());
  });

  test('leaves no empty paragraph above a break that starts it', () => {
    const tr = typeSpace(doc(lines(null, '#x')), 3);
    expect(tr?.doc.toJSON()).toEqual(doc(heading(1, 'x')).toJSON());
    expect(tr?.selection.head).toBe(1);
  });

  test('leaves a soft line break and a heading as they are', () => {
    const soft = schema.node('paragraph', null, [
      schema.text('前'),
      schema.node('hardbreak', { isInline: true }),
      schema.text('##'),
    ]);
    expect(typeSpace(doc(soft), 5)).toBeNull();
    const inHeading = schema.node('heading', { level: 1 }, [
      schema.text('前'),
      schema.node('hardbreak'),
      schema.text('##'),
    ]);
    expect(typeSpace(doc(inHeading), 5)).toBeNull();
  });
});
