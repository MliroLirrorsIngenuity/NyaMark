import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  pasteText,
  splitSoftLines,
} from '../src/editor/plugins/paste-text-lines';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    code_block: { group: 'block', content: 'text*', code: true, marks: '' },
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

const texts = (doc: ReturnType<typeof p>[]) =>
  splitSoftLines(schema.node('doc', null, doc))?.content.map((block) => [
    block.type.name,
    block.textContent,
  ]) ?? null;

describe('splitSoftLines', () => {
  test('makes each line of a paragraph a paragraph', () => {
    expect(texts([p('第一行', soft(), '第二行', soft(), '第三行')])).toEqual([
      ['paragraph', '第一行'],
      ['paragraph', '第二行'],
      ['paragraph', '第三行'],
    ]);
  });

  test('keeps a line break typed with Shift+Enter', () => {
    expect(texts([p('甲', hard(), '乙')])).toBeNull();
  });

  test('leaves the lines of other blocks as they are', () => {
    const quote = schema.node('blockquote', null, [p('引一', soft(), '引二')]);
    const result = splitSoftLines(schema.node('doc', null, [quote, p('a')]));
    expect(result).toBeNull();
  });
});

describe('pasteText', () => {
  const code = (text: string) =>
    schema.node('code_block', null, [schema.text(text)]);
  /** The blocks after pasting `blocks` between 前 and 后. */
  const paste = (blocks: ReturnType<typeof p>[]) => {
    const doc = schema.node('doc', null, [p('前后')]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const tr = pasteText(state, schema.node('doc', null, blocks));
    return (
      tr?.doc.children.map((block) => [block.type.name, block.textContent]) ??
      null
    );
  };

  test('keeps a fence the text ends with a block of its own', () => {
    expect(paste([p('说明'), code('z')])).toEqual([
      ['paragraph', '前说明'],
      ['code_block', 'z'],
      ['paragraph', '后'],
    ]);
  });

  test('leaves paragraphs without line breaks to Milkdown', () => {
    expect(paste([p('一'), p('二')])).toBeNull();
  });
});
