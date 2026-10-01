import { describe, expect, test } from 'bun:test';
import { Fragment, Schema } from '@milkdown/kit/prose/model';
import { oneLine } from '../src/editor/plugins/paste-cell';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true, marks: '' },
    table: { group: 'block', content: 'paragraph+' },
    hardbreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
  marks: { inlineCode: {}, strong: {} },
});

const p = (...parts: string[]) =>
  schema.node(
    'paragraph',
    null,
    parts.map((part) =>
      part === '\n' ? schema.node('hardbreak') : schema.text(part)
    )
  );

const line = (...blocks: ReturnType<typeof p>[]) => {
  const result = oneLine(Fragment.from(blocks), schema);
  return (
    result?.content.map((node) => [
      node.text,
      node.marks.map((mark) => mark.type.name),
    ]) ?? null
  );
};

describe('oneLine', () => {
  test('runs paragraphs into one line, a space between', () => {
    expect(line(p('第一段'), p('第二段'))).toEqual([['第一段 第二段', []]]);
  });

  test('makes line breaks spaces, keeping their marks', () => {
    const bold = schema.marks.strong.create();
    const para = schema.node('paragraph', null, [
      schema.text('甲', [bold]),
      schema.node('hardbreak', null, null, [bold]),
      schema.text('乙'),
    ]);
    expect(line(para)).toEqual([
      ['甲 ', ['strong']],
      ['乙', []],
    ]);
  });

  test('takes a code block in as inline code', () => {
    const code = schema.node('code_block', null, [schema.text('x = 1\ny = 2')]);
    expect(line(code)).toEqual([['x = 1 y = 2', ['inlineCode']]]);
  });

  test('leaves one line as it is', () => {
    expect(line(p('一行'))).toBeNull();
  });

  test('leaves a table to fill the cells', () => {
    const table = schema.node('table', null, [p('a'), p('b')]);
    expect(line(p('前'), table)).toBeNull();
  });
});
