import { describe, expect, test } from 'bun:test';
import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model';
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

const p = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
const code = (text: string) =>
  schema.node('code_block', null, [schema.text(text)]);
const item = (...blocks: ReturnType<typeof p>[]) =>
  schema.node('list_item', null, blocks);
const list = (...items: ReturnType<typeof item>[]) =>
  schema.node('bullet_list', null, items);

const open = (slice: Slice) => [slice.openStart, slice.openEnd];

describe('closeCodeEdges', () => {
  test('closes a code block at the end', () => {
    const slice = new Slice(Fragment.from([p('a'), code('b')]), 1, 1);
    expect(open(closeCodeEdges(slice))).toEqual([1, 0]);
  });

  test('closes a code block at the start', () => {
    const slice = new Slice(Fragment.from([code('a\nb'), p('c')]), 1, 1);
    expect(open(closeCodeEdges(slice))).toEqual([0, 1]);
  });

  test('leaves code of one line alone open, to go into the line', () => {
    const slice = new Slice(Fragment.from(code('npm')), 1, 1);
    expect(closeCodeEdges(slice)).toBe(slice);
  });

  test('closes code of more lines alone', () => {
    const slice = new Slice(Fragment.from(code('a\nb')), 1, 1);
    expect(open(closeCodeEdges(slice))).toEqual([0, 0]);
  });

  test('closes a code block in a list at its depth', () => {
    const slice = new Slice(
      Fragment.from(list(item(p('a')), item(code('b')))),
      3,
      3
    );
    expect(open(closeCodeEdges(slice))).toEqual([3, 2]);
  });

  test('leaves a paste with text at its sides as it is', () => {
    const slice = new Slice(Fragment.from([p('a'), code('b'), p('c')]), 1, 1);
    expect(closeCodeEdges(slice)).toBe(slice);
  });
});
