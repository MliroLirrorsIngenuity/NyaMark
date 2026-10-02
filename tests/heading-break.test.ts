import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { oneLineHeadings } from '../src/editor/plugins/heading-break';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    blockquote: { group: 'block', content: 'block+' },
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
const inline = (parts: (string | Node)[]) =>
  parts.map((part) => (typeof part === 'string' ? schema.text(part) : part));
const h = (level: number, ...parts: (string | Node)[]) =>
  schema.node('heading', { level }, inline(parts));

/** The text of each block after the headings are put on one line. */
function oneLine(...blocks: Node[]) {
  const state = EditorState.create({ doc: schema.node('doc', null, blocks) });
  const tr = oneLineHeadings(state);
  const doc = tr ? tr.doc : state.doc;
  const lines: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    lines.push(
      node.content.content
        .map((child) => (child.isText ? child.text : '⏎'))
        .join('')
    );
    return false;
  });
  return { changed: tr !== null, lines };
}

describe('oneLineHeadings', () => {
  test('joins two lines of Chinese as they were drawn', () => {
    expect(oneLine(h(3, '引用的一段话，', soft(), '第二行。')).lines).toEqual([
      '引用的一段话，第二行。',
    ]);
  });

  test('puts a space for any other break', () => {
    expect(oneLine(h(4, 'one', soft(), 'two')).lines).toEqual(['one two']);
    expect(oneLine(h(3, '一', hard(), '二')).lines).toEqual(['一 二']);
  });

  test('puts no second space beside one', () => {
    expect(oneLine(h(3, 'one ', soft(), 'two')).lines).toEqual(['one two']);
    expect(oneLine(h(3, 'one', hard(), hard(), 'two')).lines).toEqual([
      'one two',
    ]);
    expect(oneLine(h(3, hard(), 'one', hard())).lines).toEqual(['one']);
  });

  test('finds a heading in a quote', () => {
    const quote = schema.node('blockquote', null, [h(5, 'a', soft(), 'b')]);
    expect(oneLine(quote).lines).toEqual(['a b']);
  });

  test('leaves the first two levels and paragraphs, which Markdown writes so', () => {
    const paragraph = schema.node(
      'paragraph',
      null,
      inline(['a', soft(), 'b'])
    );
    const result = oneLine(
      h(1, 'a', soft(), 'b'),
      h(2, 'a', hard(), 'b'),
      paragraph
    );
    expect(result.changed).toBe(false);
    expect(result.lines).toEqual(['a⏎b', 'a⏎b', 'a⏎b']);
  });
});
