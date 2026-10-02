import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  replaceChangedRange,
  settleParsed,
  textChange,
} from '../src/editor/doc-diff';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: '' } },
    },
    rule: { group: 'block' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const h = (text: string, id = '') =>
  schema.node('heading', { id }, text ? schema.text(text) : []);
const rule = () => schema.node('rule');
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

describe('settleParsed', () => {
  const settle = (parsed: Node) =>
    settleParsed(
      parsed,
      (heading) => heading.textContent.toLowerCase(),
      (last) => (last?.type.name === 'paragraph' ? undefined : p(''))
    );

  test('gives headings their ids, numbering repeats', () => {
    const settled = settle(doc(h('A'), h('a'), quote(h('B')), h(''), p('x')));
    expect(
      settled.eq(
        doc(h('A', 'a'), h('a', 'a-#2'), quote(h('B', 'b')), h(''), p('x'))
      )
    ).toBe(true);
  });

  test('closes a document ending in another block', () => {
    expect(settle(doc(p('x'), rule())).eq(doc(p('x'), rule(), p('')))).toBe(
      true
    );
    expect(settle(doc(rule(), p('x'))).eq(doc(rule(), p('x')))).toBe(true);
  });

  test('a source edit replaces only what changed', () => {
    const shown = doc(h('Title', 'title'), p('one'), rule(), p(''));
    const tr = apply(shown, settle(doc(h('Title'), p('one!'), rule())));
    expect(tr.steps).toHaveLength(1);
    tr.mapping.maps[0].forEach((oldStart, oldEnd) => {
      expect(oldStart).toBeGreaterThan(shown.child(0).nodeSize);
      expect(oldEnd).toBeLessThan(shown.content.size - 2);
    });
  });
});

describe('textChange', () => {
  const applied = (current: string, next: string) => {
    const { from, to, insert } = textChange(current, next);
    return current.slice(0, from) + insert + current.slice(to);
  };

  test('covers only what differs', () => {
    expect(
      textChange('# A\n\none\n\nend\n', '# A\n\none, two\n\nend\n')
    ).toEqual({
      from: 8,
      to: 8,
      insert: ', two',
    });
    expect(textChange('same', 'same')).toEqual({ from: 4, to: 4, insert: '' });
  });

  test('turns one text into the other', () => {
    for (const [a, b] of [
      ['aaaa', 'aaaaa'],
      ['abab', 'ab'],
      ['', 'x'],
      ['x', ''],
      ['start', 'restart'],
    ]) {
      expect(applied(a, b)).toBe(b);
    }
  });

  test('keeps surrogate pairs whole', () => {
    const change = textChange('a😀b', 'a😃b');
    expect(change).toEqual({ from: 1, to: 3, insert: '😃' });
  });
});
