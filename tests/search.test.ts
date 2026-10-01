import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  type SearchMeta,
  createSearchPlugin,
  findMatches,
  searchKey,
} from '../src/editor/plugins/search';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true },
  },
});

const p = (...content: (string | Node)[]) =>
  schema.node(
    'paragraph',
    null,
    content.map((part) => (typeof part === 'string' ? schema.text(part) : part))
  );
const image = () => schema.node('image');
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

function matchedText(at: Node, query: string) {
  return findMatches(at, query).map(({ from, to }) => at.textBetween(from, to));
}

describe('findMatches', () => {
  test('matches case-insensitively and in document order', () => {
    const at = doc(p('Hello hello'), quote(p('say HELLO')));
    expect(matchedText(at, 'hello')).toEqual(['Hello', 'hello', 'HELLO']);
  });

  test('treats the query literally', () => {
    const at = doc(p('a.b axb (x)'));
    expect(matchedText(at, 'a.b')).toEqual(['a.b']);
    expect(matchedText(at, '(x)')).toEqual(['(x)']);
  });

  test('keeps positions right after inline atoms', () => {
    const at = doc(p('ab', image(), 'ab'));
    expect(findMatches(at, 'ab')).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ]);
  });

  test('never matches across blocks', () => {
    expect(findMatches(doc(p('foo'), p('bar')), 'foobar')).toEqual([]);
  });

  test('an empty query matches nothing', () => {
    expect(findMatches(doc(p('text')), '')).toEqual([]);
  });
});

describe('search plugin', () => {
  function searchFor(at: Node, query: string, active: number) {
    const state = EditorState.create({
      doc: at,
      plugins: [createSearchPlugin()],
    });
    const meta: SearchMeta = {
      query,
      matches: findMatches(state.doc, query),
      active,
    };
    return state.apply(state.tr.setMeta(searchKey, meta));
  }

  test('finds again when the document changes and follows the current match', () => {
    const state = searchFor(doc(p('cat dog cat')), 'cat', 1);
    const next = state.apply(state.tr.insertText('cat ', 1));
    const search = searchKey.getState(next);
    expect(
      search?.matches.map((m) => next.doc.textBetween(m.from, m.to))
    ).toEqual(['cat', 'cat', 'cat']);
    expect(search?.active).toBe(2);
  });

  test('leaves the state alone when nothing is being searched', () => {
    const state = EditorState.create({
      doc: doc(p('cat')),
      plugins: [createSearchPlugin()],
    });
    const before = searchKey.getState(state);
    const next = state.apply(state.tr.insertText('x', 1));
    expect(searchKey.getState(next)).toBe(before);
  });
});
