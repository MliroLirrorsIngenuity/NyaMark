import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  HEADING_LEVEL,
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
