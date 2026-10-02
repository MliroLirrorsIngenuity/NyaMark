import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  joinedBreaks,
  overJoinedBreak,
} from '../src/editor/plugins/cjk-breaks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    hardbreak: {
      group: 'inline',
      inline: true,
      attrs: { isInline: { default: false } },
    },
    text: { group: 'inline' },
  },
});

const soft = () => schema.node('hardbreak', { isInline: true });
const hard = () => schema.node('hardbreak');
const p = (...parts: (string | ReturnType<typeof soft>)[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) => (typeof part === 'string' ? schema.text(part) : part))
  );
const doc = (...blocks: ReturnType<typeof p>[]) =>
  schema.node('doc', null, blocks);

/** The line with the caret at `head`, or a selection from `anchor`. */
function state(line: ReturnType<typeof p>, head: number, anchor = head) {
  const at = doc(line);
  return EditorState.create({
    doc: at,
    selection: TextSelection.create(at, anchor, head),
  });
}

describe('joinedBreaks', () => {
  test('finds a line break between Chinese characters', () => {
    expect(joinedBreaks(doc(p('第一行，', soft(), '第二行')))).toEqual([5]);
  });

  test('leaves a break beside a Latin letter or a space', () => {
    expect(joinedBreaks(doc(p('one', soft(), '二')))).toEqual([]);
    expect(joinedBreaks(doc(p('一 ', soft(), '二')))).toEqual([]);
  });

  test('leaves a line break typed with Shift+Enter', () => {
    expect(joinedBreaks(doc(p('一', hard(), '二')))).toEqual([]);
  });

  test('counts kana and a character past the basic plane', () => {
    expect(joinedBreaks(doc(p('かな', soft(), '𠀋')))).toEqual([3]);
  });
});

describe('overJoinedBreak', () => {
  // 1 甲 2 ， 3 ⏎ 4 乙 5
  const line = p('甲，', soft(), '乙丙');

  test('→ before the break goes past the character after it', () => {
    const tr = overJoinedBreak(state(line, 3), 'ArrowRight', false);
    expect(tr?.selection.head).toBe(5);
  });

  test('← after the break goes past the character before it', () => {
    const tr = overJoinedBreak(state(line, 4), 'ArrowLeft', false);
    expect(tr?.selection.head).toBe(2);
  });

  test('Shift keeps the anchor', () => {
    const tr = overJoinedBreak(state(line, 4, 6), 'ArrowLeft', true);
    expect([tr?.selection.anchor, tr?.selection.head]).toEqual([6, 2]);
  });

  test('Backspace after the break takes the character before it', () => {
    const tr = overJoinedBreak(state(line, 4), 'Backspace', false);
    expect(tr?.doc.textContent).toBe('甲乙丙');
    expect(tr?.doc.firstChild?.childCount).toBe(3);
    expect(tr?.selection.head).toBe(3);
  });

  test('Delete before the break takes the character after it', () => {
    const tr = overJoinedBreak(state(line, 3), 'Delete', false);
    expect(tr?.doc.textContent).toBe('甲，丙');
    expect(tr?.selection.head).toBe(3);
  });

  test('keys elsewhere in the line are left alone', () => {
    expect(overJoinedBreak(state(line, 2), 'ArrowRight', false)).toBeNull();
    expect(overJoinedBreak(state(line, 5), 'Backspace', false)).toBeNull();
  });
});
