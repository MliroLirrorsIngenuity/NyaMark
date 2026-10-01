import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  IMAGE,
  LINK,
  typedImage,
  typedLink,
} from '../src/editor/plugins/link-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    'image-block': {
      group: 'block',
      atom: true,
      attrs: { src: {}, alt: {}, caption: {} },
    },
    text: { group: 'inline' },
    image: {
      group: 'inline',
      inline: true,
      attrs: { src: {}, alt: {}, title: {} },
    },
  },
  marks: {
    link: { attrs: { href: {}, title: { default: null } } },
    strong: {},
  },
});

/** Types `text` then the last character the way the input rule sees it. */
function type(text: string, rule: RegExp, handler: typeof typedLink) {
  const typed = text.slice(0, -1);
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, typed ? [schema.text(typed)] : []),
  ]);
  const end = 1 + typed.length;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const match = rule.exec(text);
  if (!match) return null;
  const start = end - (match[0].length - 1);
  const tr = handler(state, match, start, end);
  return tr && state.apply(tr);
}

describe('a link typed as Markdown', () => {
  test('becomes a link on its closing parenthesis', () => {
    const state = type('看 [文档](https://a.com "标题")', LINK, typedLink);
    const para = state?.doc.firstChild;
    expect(para?.textContent).toBe('看 文档');
    const link = para?.lastChild?.marks[0];
    expect(link?.attrs).toEqual({ href: 'https://a.com', title: '标题' });
    expect(state?.storedMarks).toEqual([]);
  });

  test('stays text after a backslash, an unclosed backtick or a bang', () => {
    expect(type('\\[a](b)', LINK, typedLink)).toBeNull();
    expect(type('`[a](b)', LINK, typedLink)).toBeNull();
    expect(LINK.exec('![a](b)')).toBeNull();
  });
});

describe('an image typed as Markdown', () => {
  test('alone on its line becomes an image block with a line below', () => {
    const state = type('![猫](cat.png "说明")', IMAGE, typedImage);
    const block = state?.doc.firstChild;
    expect(block?.type.name).toBe('image-block');
    expect(block?.attrs).toEqual({
      src: 'cat.png',
      alt: '猫',
      caption: '说明',
    });
    expect(state?.doc.childCount).toBe(2);
    expect(state?.selection.$head.parent).toBe(state?.doc.lastChild ?? null);
  });

  test('within text is an inline image', () => {
    const state = type('图 ![猫](cat.png)', IMAGE, typedImage);
    const para = state?.doc.firstChild;
    expect(para?.type.name).toBe('paragraph');
    expect(para?.lastChild?.type.name).toBe('image');
    expect(para?.lastChild?.attrs.src).toBe('cat.png');
  });
});
