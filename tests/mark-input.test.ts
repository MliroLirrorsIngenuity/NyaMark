import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  CODE_CLOSE,
  CODE_OPENED,
  EMPHASIS_STAR,
  EMPHASIS_STAR_CLOSE,
  EMPHASIS_STAR_OPENED,
  EMPHASIS_UNDERSCORE,
  EMPHASIS_UNDERSCORE_CLOSE,
  EMPHASIS_UNDERSCORE_OPENED,
  STRIKETHROUGH,
  STRONG_EMPHASIS_STARS,
  STRONG_EMPHASIS_UNDERSCORES,
  STRONG_STARS,
  STRONG_STARS_CLOSE,
  STRONG_STARS_OPENED,
  STRONG_UNDERSCORES,
  markBetween,
  markText,
} from '../src/editor/plugins/mark-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: { strong: {}, em: {}, emphasis: {}, inlineCode: { code: true } },
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

/** `typed` at the caret between `before` and `after`, in a pair of `close`. */
function typeBetween(
  before: string,
  after: string,
  typed: string,
  opened: RegExp,
  close: RegExp,
  names: string
) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text(before + after)),
  ]);
  const end = 1 + before.length;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const match = `${before}${typed}`.match(opened);
  if (!match) return null;
  const start = end - (match[0].length - typed.length);
  return markBetween(names, close)(state, match, start, end);
}

describe('markBetween', () => {
  test('makes code of what is typed between two backticks', () => {
    const tr = typeBetween(
      '前`',
      '`后',
      'a',
      CODE_OPENED,
      CODE_CLOSE,
      'inlineCode'
    );
    expect(tr?.doc.toJSON().content[0].content).toEqual([
      { type: 'text', text: '前' },
      { type: 'text', text: 'a', marks: [{ type: 'inlineCode' }] },
      { type: 'text', text: '后' },
    ]);
    expect(tr?.selection.head).toBe(3);
  });

  test('takes text an input method put in', () => {
    const tr = typeBetween(
      '`文本',
      '`',
      '',
      CODE_OPENED,
      CODE_CLOSE,
      'inlineCode'
    );
    expect(tr?.doc.toJSON().content[0].content).toEqual([
      { type: 'text', text: '文本', marks: [{ type: 'inlineCode' }] },
    ]);
    expect(tr?.selection.head).toBe(3);
  });

  test('needs the closing backtick right after the caret', () => {
    expect(
      typeBetween('`a', ' `', 'b', CODE_OPENED, CODE_CLOSE, 'inlineCode')
    ).toBeNull();
    expect(
      typeBetween('`a', '``', 'b', CODE_OPENED, CODE_CLOSE, 'inlineCode')
    ).toBeNull();
    expect(
      typeBetween('`', '`', ' ', CODE_OPENED, CODE_CLOSE, 'inlineCode')
    ).toBeNull();
  });

  test('makes bold and italic between their stars', () => {
    const bold = typeBetween(
      '要**',
      '**',
      '粗',
      STRONG_STARS_OPENED,
      STRONG_STARS_CLOSE,
      'strong'
    );
    expect(bold?.doc.toJSON().content[0].content).toEqual([
      { type: 'text', text: '要' },
      { type: 'text', text: '粗', marks: [{ type: 'strong' }] },
    ]);
    expect(
      typeBetween(
        '*',
        '*',
        'a',
        EMPHASIS_STAR_OPENED,
        EMPHASIS_STAR_CLOSE,
        'em'
      )?.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)
    ).toEqual(['em']);
    expect(
      typeBetween(
        '**',
        '**',
        'a',
        EMPHASIS_STAR_OPENED,
        EMPHASIS_STAR_CLOSE,
        'em'
      )
    ).toBeNull();
    expect(
      typeBetween(
        '*',
        '*',
        ' ',
        EMPHASIS_STAR_OPENED,
        EMPHASIS_STAR_CLOSE,
        'em'
      )
    ).toBeNull();
  });

  test('leaves underscores inside a word as text', () => {
    const underscores = (before: string, after: string) =>
      typeBetween(
        before,
        after,
        'a',
        EMPHASIS_UNDERSCORE_OPENED,
        EMPHASIS_UNDERSCORE_CLOSE,
        'em'
      );
    expect(underscores('价格_', '_')).toBeNull();
    expect(underscores(' _', '_标签')).toBeNull();
    expect(underscores(' _', '_ ')).not.toBeNull();
  });
});
