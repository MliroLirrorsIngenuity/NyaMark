import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  bareLinkIn,
  typedSpaceAfterLink,
} from '../src/editor/plugins/bare-link-input';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
  marks: {
    link: {
      attrs: {
        href: { default: '' },
        title: { default: null },
        bare: { default: false },
      },
    },
    inlineCode: { code: true },
  },
});

const doc = (text: string) =>
  schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text(text)]),
  ]);

/** The links in `node`, as their text and address. */
function links(node: Node) {
  const found: string[] = [];
  node.descendants((child) => {
    const link = child.marks.find((mark) => mark.type.name === 'link');
    if (link) found.push(`${child.text} ${link.attrs.href}`);
  });
  return found;
}

/** A space typed at the end of the line `text`. */
function space(text: string) {
  const start = doc(text);
  const end = text.length + 1;
  const state = EditorState.create({
    doc: start,
    selection: TextSelection.create(start, end),
  });
  const match = `${text} `.match(/[^\s<]\s$/);
  if (!match) return null;
  return typedSpaceAfterLink(state, match, end - 1, end)?.doc ?? null;
}

describe('the address GFM reads in a word', () => {
  test('of each kind, with the address it links to', () => {
    expect(bareLinkIn('https://a.com/x')).toEqual({
      from: 0,
      to: 15,
      href: 'https://a.com/x',
    });
    expect(bareLinkIn('www.a.com')?.href).toBe('http://www.a.com');
    expect(bareLinkIn('me@a.com')?.href).toBe('mailto:me@a.com');
  });

  test('short of the punctuation that closes a sentence', () => {
    expect(bareLinkIn('https://a.com/x.')?.to).toBe(15);
    expect(bareLinkIn('(https://a.com/x)')).toMatchObject({ from: 1, to: 16 });
    expect(bareLinkIn('https://a.com/x_(y)')?.to).toBe(19);
    expect(bareLinkIn('https://a.com，然后')?.to).toBe(13);
  });

  test('only where GFM starts one', () => {
    expect(bareLinkIn('xhttps://a.com')).toBeNull();
    expect(bareLinkIn('（www.a.com')).toBeNull();
    expect(bareLinkIn('a/me@a.com')).toBeNull();
  });

  test('only on a domain GFM links', () => {
    expect(bareLinkIn('https://')).toBeNull();
    expect(bareLinkIn('www.a_b.com')).toBeNull();
    expect(bareLinkIn('me@a.c-')).toBeNull();
  });
});

describe('a space typed after an address', () => {
  test('makes it a link, the space outside it', () => {
    const out = space('见 https://a.com');
    expect(out && links(out)).toEqual(['https://a.com https://a.com']);
    expect(out?.textContent).toBe('见 https://a.com ');
  });

  test('is left alone after other text', () => {
    expect(space('见 a.com')).toBeNull();
  });

  test('leaves the text of a code span being typed', () => {
    expect(space('见 `https://a.com')).toBeNull();
  });
});
