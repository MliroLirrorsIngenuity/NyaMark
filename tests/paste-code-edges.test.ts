import { describe, expect, test } from 'bun:test';
import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { closeCodeEdges } from '../src/editor/plugins/paste-code-edges';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true, marks: '' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'block+' },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const code = (text: string) =>
  schema.node('code_block', null, [schema.text(text)]);
const item = (...blocks: ReturnType<typeof p>[]) =>
  schema.node('list_item', null, blocks);
const list = (...items: ReturnType<typeof item>[]) =>
  schema.node('bullet_list', null, items);

/** The line `前后`, the caret between the two. */
const line = schema.node('doc', null, [p('前后')]);
const mid = TextSelection.create(line, 2);

const open = (slice: Slice) => [slice.openStart, slice.openEnd];

describe('closeCodeEdges', () => {
  test('closes a code block at the end', () => {
    const slice = new Slice(Fragment.from([p('a'), code('b')]), 1, 1);
    expect(open(closeCodeEdges(slice, mid))).toEqual([1, 0]);
  });

  test('closes a code block at the start', () => {
    const slice = new Slice(Fragment.from([code('a\nb'), p('c')]), 1, 1);
    expect(open(closeCodeEdges(slice, mid))).toEqual([0, 1]);
  });

  test('leaves code of one line alone open, to go into the line', () => {
    const slice = new Slice(Fragment.from(code('npm')), 1, 1);
    expect(closeCodeEdges(slice, mid)).toBe(slice);
  });

  test('closes code of more lines alone', () => {
    const slice = new Slice(Fragment.from(code('a\nb')), 1, 1);
    expect(open(closeCodeEdges(slice, mid))).toEqual([0, 0]);
  });

  test('closes a code block in a list at its depth', () => {
    const slice = new Slice(
      Fragment.from(list(item(p('a')), item(code('b')))),
      3,
      3
    );
    expect(open(closeCodeEdges(slice, mid))).toEqual([3, 2]);
  });

  test('leaves a paste with text at its sides as it is', () => {
    const slice = new Slice(Fragment.from([p('a'), code('b'), p('c')]), 1, 1);
    expect(closeCodeEdges(slice, mid)).toBe(slice);
  });

  test('leaves the end open at the end of a line', () => {
    const slice = new Slice(Fragment.from([code('a\nb'), code('c')]), 1, 1);
    const end = TextSelection.create(line, 3);
    expect(open(closeCodeEdges(slice, end))).toEqual([0, 1]);
  });

  test('leaves code over all of a line to take its place', () => {
    const slice = new Slice(Fragment.from([code('a\nb'), code('c')]), 1, 1);
    const empty = schema.node('doc', null, [p('')]);
    expect(closeCodeEdges(slice, TextSelection.create(empty, 1))).toBe(slice);
    expect(closeCodeEdges(slice, TextSelection.create(line, 1, 3))).toBe(slice);
  });
});
