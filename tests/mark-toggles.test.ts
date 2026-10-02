import { describe, expect, test } from 'bun:test';
import { type Mark, Schema } from '@milkdown/kit/prose/model';
import {
  type Command,
  EditorState,
  TextSelection,
} from '@milkdown/kit/prose/state';
import {
  markedThroughout,
  toggleCodeThroughout,
  toggleThroughout,
} from '../src/editor/plugins/mark-toggles';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', marks: '' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    emphasis: {},
    inlineCode: { excludes: '_' },
  },
});

const { strong, emphasis, inlineCode } = schema.marks;

type Part = string | [string, ...Mark[]];
const p = (...parts: Part[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) =>
      typeof part === 'string'
        ? schema.text(part)
        : schema.text(part[0], part.slice(1) as Mark[])
    )
  );

/** One line selected from `from` to `to`. */
function state(line: ReturnType<typeof p>, from: number, to: number) {
  const doc = schema.node('doc', null, [line]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

/** The line after `command`, as each run of text with its marks. */
function run(at: EditorState, command: Command) {
  let next = at;
  command(at, (tr) => {
    next = at.apply(tr);
  });
  const runs: string[] = [];
  next.doc.firstChild?.forEach((node) => {
    const marks = node.marks.map((mark) => mark.type.name).join('+');
    runs.push(marks ? `${node.text}:${marks}` : `${node.text}`);
  });
  return runs;
}

describe('markedThroughout', () => {
  test('holds where all of the selection has the mark', () => {
    const line = p(['one', strong.create()], ['two', strong.create()]);
    expect(markedThroughout(state(line, 1, 7), strong)).toBe(true);
  });

  test('fails where a part of the selection lacks it', () => {
    const line = p('one ', ['two', strong.create()], ' three');
    expect(markedThroughout(state(line, 1, 14), strong)).toBe(false);
    expect(markedThroughout(state(line, 5, 8), strong)).toBe(true);
  });

  test('passes over space without the mark', () => {
    const line = p(['one', strong.create()], ' ', ['two', strong.create()]);
    expect(markedThroughout(state(line, 1, 8), strong)).toBe(true);
  });

  test('reads the marks typing takes at a caret', () => {
    const line = p(['one', strong.create()], ' two');
    expect(markedThroughout(state(line, 2, 2), strong)).toBe(true);
    expect(markedThroughout(state(line, 7, 7), strong)).toBe(false);
  });

  test('leaves out what cannot have the mark', () => {
    const doc = schema.node('doc', null, [
      p(['one', strong.create()]),
      schema.node('code_block', null, [schema.text('code')]),
    ]);
    const at = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    expect(markedThroughout(at, strong)).toBe(true);
  });
});

describe('toggleThroughout', () => {
  test('puts the mark on all of a selection that has it in part', () => {
    const line = p('one ', ['two', strong.create()], ' three');
    expect(run(state(line, 1, 14), toggleThroughout(strong))).toEqual([
      'one two three:strong',
    ]);
  });

  test('takes it off where all of the selection has it', () => {
    const line = p('one ', ['two', strong.create()], ' three');
    expect(run(state(line, 5, 8), toggleThroughout(strong))).toEqual([
      'one two three',
    ]);
  });

  test('keeps the other marks', () => {
    const line = p(['one', emphasis.create()], ' two');
    expect(run(state(line, 1, 8), toggleThroughout(strong))).toEqual([
      'one:strong+emphasis',
      ' two:strong',
    ]);
  });
});

describe('toggleCodeThroughout', () => {
  test('puts code on all of the selection in place of its marks', () => {
    const line = p(['one', strong.create()], ' two');
    expect(run(state(line, 1, 8), toggleCodeThroughout(inlineCode))).toEqual([
      'one two:inlineCode',
    ]);
  });

  test('takes it off where all of the selection is code', () => {
    const line = p('one ', ['two', inlineCode.create()]);
    expect(run(state(line, 5, 8), toggleCodeThroughout(inlineCode))).toEqual([
      'one two',
    ]);
  });

  test('does nothing at a caret', () => {
    const line = p('one');
    expect(toggleCodeThroughout(inlineCode)(state(line, 2, 2))).toBe(false);
  });
});
