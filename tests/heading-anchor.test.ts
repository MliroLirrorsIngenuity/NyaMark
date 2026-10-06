import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { Transform } from '@milkdown/kit/prose/transform';
import {
  headingId,
  headingLabel,
  pageId,
  setHeadingIds,
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
  test('is the anchor GitHub gives the text', () => {
    expect(headingId(heading('Hello, World!', math('x')))).toBe('hello-world');
    expect(headingId(heading('第二节：用法'))).toBe('第二节用法');
    expect(headingId(heading('Q&A  time'))).toBe('qa--time');
  });

  test('is made from the label of a heading with no text', () => {
    expect(headingId(heading(math('E = mc^2')))).toBe('e--mc2');
    expect(headingId(heading(image('Logo')))).toBe('logo');
    expect(headingId(heading())).toBe('');
  });

  test('gives way to the id the heading has', () => {
    const set = schema.node('heading', { id: 'old' }, [math('x')]);
    expect(pageId(set)).toBe('old');
    expect(pageId(heading(math('x')))).toBe('x');
  });
});

describe('setHeadingIds', () => {
  const ids = (...headings: Node[]) => {
    const tr = setHeadingIds(new Transform(schema.node('doc', null, headings)));
    return Array.from(
      { length: tr.doc.childCount },
      (_, index) => tr.doc.child(index).attrs.id
    );
  };

  test('a name taken gets a number after it, as on GitHub', () => {
    expect(
      ids(
        heading('用法'),
        heading('用法'),
        heading('Intro'),
        heading('用法-1'),
        heading('用法')
      )
    ).toEqual(['用法', '用法-1', 'intro', '用法-1-1', '用法-2']);
  });

  test('a heading with nothing to show has no id', () => {
    const stale = schema.node('heading', { id: 'old' }, [image('')]);
    expect(ids(heading(), stale, heading(math('x')))).toEqual(['', '', 'x']);
  });

  test('leaves the headings that have their ids', () => {
    const tr = setHeadingIds(
      new Transform(
        schema.node('doc', null, [
          schema.node('heading', { id: 'a' }, [schema.text('A')]),
          heading('B'),
        ])
      )
    );
    expect(tr.steps).toHaveLength(1);
  });
});
