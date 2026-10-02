import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  EMPHASIS_STAR,
  EMPHASIS_UNDERSCORE,
  STRIKETHROUGH,
  STRONG_EMPHASIS_STARS,
  STRONG_EMPHASIS_UNDERSCORES,
  STRONG_STARS,
  STRONG_UNDERSCORES,
  markText,
} from '../src/editor/plugins/mark-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: { strong: {}, em: {} },
});

/** Whether typing the last character of `typed` closes `pattern`. */
const closes = (pattern: RegExp, typed: string) => pattern.test(typed);

describe('typed emphasis', () => {
  test('takes text between stars or underscores', () => {
    expect(closes(EMPHASIS_STAR, '一个 *重点*')).toBe(true);
    expect(closes(EMPHASIS_STAR, 'a*b*')).toBe(true);
    expect(closes(EMPHASIS_UNDERSCORE, '一个 _重点_')).toBe(true);
  });

  test('takes no text that starts or ends on a space', () => {
    expect(closes(EMPHASIS_STAR, '3 * 4 *')).toBe(false);
    expect(closes(EMPHASIS_STAR, '*a *')).toBe(false);
    expect(closes(EMPHASIS_UNDERSCORE, '_ a_')).toBe(false);
  });

  test('leaves underscores inside a word as text', () => {
    expect(closes(EMPHASIS_UNDERSCORE, '价格_标签_')).toBe(false);
    expect(closes(EMPHASIS_UNDERSCORE, 'snake_case_')).toBe(false);
    expect(closes(STRONG_UNDERSCORES, 'a__b__')).toBe(false);
  });

  test('leaves bold to its own rule', () => {
    expect(closes(EMPHASIS_STAR, '**粗*')).toBe(false);
    expect(closes(EMPHASIS_STAR, '**粗**')).toBe(false);
    expect(closes(STRONG_STARS, '**粗*')).toBe(false);
    expect(closes(STRONG_STARS, '**粗**')).toBe(true);
    expect(closes(STRONG_UNDERSCORES, '__粗__')).toBe(true);
  });

  test('takes three stars or underscores as bold and italic', () => {
    expect(closes(STRONG_EMPHASIS_STARS, '前文***重点***')).toBe(true);
    expect(closes(STRONG_EMPHASIS_UNDERSCORES, '前 ___重点___')).toBe(true);
    expect(closes(STRONG_EMPHASIS_UNDERSCORES, '前___重点___')).toBe(false);
    expect(closes(STRONG_STARS, '***重点**')).toBe(false);
    expect(closes(EMPHASIS_STAR, '***重点*')).toBe(false);
  });

  test('closes only on the key typed', () => {
    expect(closes(EMPHASIS_UNDERSCORE, '转义 _b_ 后好')).toBe(false);
    expect(closes(STRIKETHROUGH, '好的 ~~a~~ 后')).toBe(false);
  });
});

describe('markText', () => {
  test('marks the text and drops the delimiters', () => {
    const before = '要 **粗*';
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text(before)),
    ]);
    const end = before.length + 1;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, end),
    });
    const match = `${before}*`.match(STRONG_STARS);
    if (!match) throw new Error('no match');
    const tr = markText('strong')(
      state,
      match,
      end - (match[0].length - 1),
      end
    );
    expect(tr?.doc.toJSON().content[0].content).toEqual([
      { type: 'text', text: '要 ' },
      { type: 'text', text: '粗', marks: [{ type: 'strong' }] },
    ]);
    expect(tr?.storedMarks).toEqual([]);
  });

  test('gives the text both marks, and what is typed next neither', () => {
    const before = '要 ***粗**';
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text(before)),
    ]);
    const end = before.length + 1;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, end),
    });
    const match = `${before}*`.match(STRONG_EMPHASIS_STARS);
    if (!match) throw new Error('no match');
    const tr = markText(['strong', 'em'])(
      state,
      match,
      end - (match[0].length - 1),
      end
    );
    expect(tr?.doc.toJSON().content[0].content).toEqual([
      { type: 'text', text: '要 ' },
      { type: 'text', text: '粗', marks: [{ type: 'strong' }, { type: 'em' }] },
    ]);
    expect(tr?.storedMarks).toEqual([]);
  });
});
