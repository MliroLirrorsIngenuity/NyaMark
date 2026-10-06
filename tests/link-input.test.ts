import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { type Parse, typedLink } from '../src/editor/plugins/link-input';

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
    code: { code: true },
  },
});

const processor = unified().use(remarkParse).use(remarkGfm);
const parse: Parse = (markdown) => processor.parse(markdown);

/** Types `text` then the last character the way the input rule sees it. */
function type(text: string) {
  const typed = text.slice(0, -1);
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, typed ? [schema.text(typed)] : []),
  ]);
  const end = 1 + typed.length;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const tr = typedLink(state, text.slice(-1), end, end, parse);
  return tr && state.apply(tr);
}

const linkOf = (text: string) => {
  const para = type(text)?.doc.firstChild;
  const link = para?.lastChild?.marks.find((mark) => mark.type.name === 'link');
  return link && { text: para?.textContent, ...link.attrs };
};

describe('a link typed as Markdown', () => {
  test('becomes a link on its closing parenthesis', () => {
    const state = type('看 [文档](https://a.com "标题")');
    const para = state?.doc.firstChild;
    expect(para?.textContent).toBe('看 文档');
    const link = para?.lastChild?.marks[0];
    expect(link?.attrs).toEqual({ href: 'https://a.com', title: '标题' });
    expect(state?.storedMarks).toEqual([]);
  });

  test('keeps the bold and image in its text', () => {
    const strong = schema.mark('strong');
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('看 ['),
        schema.text('粗', [strong]),
        schema.node('image', { src: 'a.png', alt: '', title: '' }),
        schema.text('](u'),
      ]),
    ]);
    const end = doc.content.size - 1;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, end),
    });
    const para = state.apply(typedLink(state, ')', end, end, parse) ?? state.tr)
      .doc.firstChild;
    expect(para?.childCount).toBe(3);
    const link = schema.mark('link', { href: 'u' });
    expect(para?.child(1).marks).toEqual([link, strong]);
    expect(para?.child(2).type.name).toBe('image');
    expect(para?.child(2).marks).toEqual([link]);
  });

  test('takes its address and title as Markdown reads them', () => {
    expect(linkOf('[a](<b c>)')).toEqual({
      text: 'a',
      href: 'b c',
      title: null,
    });
    expect(linkOf('[a](b(c))')).toEqual({
      text: 'a',
      href: 'b(c)',
      title: null,
    });
    expect(linkOf("[a](b 't')")).toEqual({ text: 'a', href: 'b', title: 't' });
    expect(linkOf('[a](b\\)c)')).toEqual({
      text: 'a',
      href: 'b)c',
      title: null,
    });
    expect(linkOf('`x` [a [b] c](u)')).toEqual({
      text: '`x` a [b] c',
      href: 'u',
      title: null,
    });
  });

  test('stays text where Markdown reads none, or a backtick could make code', () => {
    for (const text of [
      '\\[a](b)',
      '`[a](b)',
      '[a`b](c)',
      '[a](b c)',
      '[a](b',
      'www.a.com/(x)',
      '[](u)',
    ]) {
      expect(type(text)).toBeNull();
    }
  });

  test('leaves brackets in code it follows as text', () => {
    const code = schema.mark('code');
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('[a', [code]),
        schema.text('](u'),
      ]),
    ]);
    const end = doc.content.size - 1;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, end),
    });
    expect(typedLink(state, ')', end, end, parse)).toBeNull();
  });
});

describe('an image typed as Markdown', () => {
  test('alone on its line becomes an image block with a line below', () => {
    const state = type('![猫](cat.png "说明")');
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
    const state = type('图 ![猫](cat.png)');
    const para = state?.doc.firstChild;
    expect(para?.type.name).toBe('paragraph');
    expect(para?.lastChild?.type.name).toBe('image');
    expect(para?.lastChild?.attrs.src).toBe('cat.png');
  });

  test('takes the description Markdown reads from its brackets', () => {
    const image = type('图 ![*猫* 与 `狗`](<a b.png>)')?.doc.firstChild
      ?.lastChild;
    expect(image?.attrs).toEqual({
      src: 'a b.png',
      alt: '猫 与 狗',
      title: '',
    });
  });
});
