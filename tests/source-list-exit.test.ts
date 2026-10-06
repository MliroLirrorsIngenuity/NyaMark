import { describe, expect, test } from 'bun:test';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Transaction } from '@codemirror/state';
import { continueMarkup } from '../src/editor/source-list-exit';

/** `text` after Enter at its `|`, the caret shown as `|` again. */
function enter(text: string): string | null {
  const at = text.indexOf('|');
  const state = EditorState.create({
    doc: text.replace('|', ''),
    selection: { anchor: at },
    extensions: [markdown({ base: markdownLanguage })],
  });
  let next: Transaction | null = null;
  const run = continueMarkup({
    state,
    dispatch: (tr) => {
      next = tr;
    },
  });
  if (!run || !next) return null;
  const done = (next as Transaction).state;
  const head = done.selection.main.head;
  return `${done.doc.sliceString(0, head)}|${done.doc.sliceString(head)}`;
}

describe('continueMarkup', () => {
  test('leaves a list with a blank line after it', () => {
    expect(enter('- a\n- b\n- |')).toBe('- a\n- b\n\n|');
    expect(enter('- [x] a\n- [ ] b\n- [ ] |')).toBe('- [x] a\n- [ ] b\n\n|');
    expect(enter('1. a\n2. b\n3. |\n\nnext')).toBe('1. a\n2. b\n\n|\n\nnext');
    expect(enter('  - a\n  - b\n  - |')).toBe('  - a\n  - b\n\n|');
  });

  test('continues an item as before', () => {
    expect(enter('- a|')).toBe('- a\n- |');
    expect(enter('- [x] a|')).toBe('- [x] a\n- [ ] |');
  });

  test('goes up a level from an empty nested item', () => {
    expect(enter('- a\n  - b\n  - c\n  - |')).toBe('- a\n  - b\n  - c\n- |');
  });

  test('leaves a quoted list as before', () => {
    expect(enter('> - a\n> - b\n> - |')).toBe('> - a\n> - b\n> |');
  });
});
