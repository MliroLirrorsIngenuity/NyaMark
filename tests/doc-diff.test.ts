import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { replaceChangedRange } from '../src/editor/doc-diff';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const quote = (...blocks: Node[]) => schema.node('blockquote', null, blocks);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

function apply(from: Node, to: Node) {
  const tr = replaceChangedRange(EditorState.create({ doc: from }).tr, to);
  expect(tr.doc.eq(to)).toBe(true);
  return tr;
}

describe('replaceChangedRange', () => {
  test('leaves equal documents alone', () => {
    const tr = apply(doc(p('a'), p('b')), doc(p('a'), p('b')));
    expect(tr.docChanged).toBe(false);
  });

  test('replaces only the typed characters', () => {
    const tr = apply(doc(p('hello'), p('world')), doc(p('hello'), p('wor!ld')));
    expect(tr.steps).toHaveLength(1);
    const map = tr.mapping.maps[0];
    let span = 0;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      span = Math.max(oldEnd - oldStart, newEnd - newStart);
    });
    expect(span).toBe(1);
  });

  test('handles repeated text where prefix and suffix overlap', () => {
    apply(doc(p('aaaa')), doc(p('aaaaa')));
    apply(doc(p('abab')), doc(p('ab')));
  });

  test('handles structural changes', () => {
    apply(doc(p('a'), p('b')), doc(quote(p('a')), p('b')));
    apply(doc(quote(p('a'), p('b'))), doc(p('a'), p('b')));
    apply(doc(p('one'), p('two'), p('three')), doc(p('one'), p('three')));
    apply(doc(p('x')), doc(p('')));
  });
});
