import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import {
  anchorIndex,
  headingId,
  headingLabel,
  headingSlugs,
  pageId,
} from '../src/editor/heading-anchor';

const schema = new Schema({
  nodes: {
    doc: { content: 'heading+' },
    heading: { content: 'inline*', attrs: { id: { default: '' } } },
    math_inline: { group: 'inline', inline: true, attrs: { value: {} } },
    image: { group: 'inline', inline: true, attrs: { src: {}, alt: {} } },
    hardbreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
});

const heading = (...parts: (string | Node)[]) =>
  schema.node(
    'heading',
    null,
    parts.map((part) => (typeof part === 'string' ? schema.text(part) : part))
  );
const math = (value: string) => schema.node('math_inline', { value });
const image = (alt: string) => schema.node('image', { src: 'a.png', alt });

describe('headingLabel', () => {
  test('shows a formula by its TeX and an image by its alt text', () => {
    expect(headingLabel(heading(math('E=mc^2')))).toBe('E=mc^2');
    expect(headingLabel(heading(image('logo')))).toBe('logo');
    expect(headingLabel(heading('质能方程 ', math('E=mc^2')))).toBe(
      '质能方程 E=mc^2'
    );
  });

  test('puts a space for a line break and none at the ends', () => {
    expect(
      headingLabel(heading(' a', schema.node('hardbreak'), 'b ', image('')))
    ).toBe('a b');
    expect(headingLabel(heading())).toBe('');
  });
});

describe('headingId', () => {
  test('is made from the text as Milkdown makes it', () => {
    expect(headingId(heading('Hello  World', math('x')))).toBe('hello-world');
  });

  test('is made from the label of a heading with no text', () => {
    expect(headingId(heading(math('E = mc^2')))).toBe('e-=-mc^2');
    expect(headingId(heading(image('Logo')))).toBe('logo');
    expect(headingId(heading())).toBe('');
  });

  test('gives way to the id Milkdown set', () => {
    const set = schema.node('heading', { id: 'old' }, [math('x')]);
    expect(pageId(set)).toBe('old');
    expect(pageId(heading(math('x')))).toBe('x');
  });
});

describe('headingSlugs', () => {
  test('lower case, punctuation dropped, spaces as hyphens', () => {
    expect(
      headingSlugs(['Hello, World!', '第二节：用法', 'a_b c-d', 'Q&A  time'])
    ).toEqual(['hello-world', '第二节用法', 'a_b-c-d', 'qa--time']);
  });

  test('a name taken gets a number after it', () => {
    expect(headingSlugs(['用法', '用法', 'Intro', '用法-1', '用法'])).toEqual([
      '用法',
      '用法-1',
      'intro',
      '用法-1-1',
      '用法-2',
    ]);
  });
});

describe('anchorIndex', () => {
  const texts = ['概述', 'Getting Started', '概述'];

  test('finds the heading a fragment names', () => {
    expect(anchorIndex(texts, 'getting-started')).toBe(1);
    expect(anchorIndex(texts, '概述-1')).toBe(2);
  });

  test('reads the fragment escaped and in any case', () => {
    expect(anchorIndex(texts, encodeURIComponent('概述'))).toBe(0);
    expect(anchorIndex(texts, 'Getting-Started')).toBe(1);
  });

  test('is -1 for a name no heading has', () => {
    expect(anchorIndex(texts, 'missing')).toBe(-1);
    expect(anchorIndex(texts, '%E0%A4%A')).toBe(-1);
  });
});
