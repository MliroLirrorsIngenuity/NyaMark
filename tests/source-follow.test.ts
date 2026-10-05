import { describe, expect, test } from 'bun:test';
import type { Node } from '@milkdown/kit/prose/model';
import { applyChanges, rewriteBlocks } from '../src/editor/source-follow';
import {
  code,
  doc,
  env,
  h,
  hr,
  p,
  parse,
  serialize,
  ul,
} from './ai-edit-helpers';

function follow(text: string, after: Node) {
  const before = parse(text);
  const changes = rewriteBlocks(
    text,
    env.blockSpans(text),
    before,
    after,
    serialize
  );
  if (!changes) throw new Error('no changes');
  const next = applyChanges(text, changes);
  expect(parse(next).eq(after)).toBe(true);
  return next;
}

const children = (node: Node) => {
  const list: Node[] = [];
  for (let i = 0; i < node.childCount; i++) list.push(node.child(i));
  return list;
};

describe('the source pane following the editor', () => {
  const text = 'one\nline\n\ntwo\n\nthree\nlines\n';

  test('writes anew only the blocks that changed', () => {
    expect(follow(text, doc(p('one line'), p('TWO'), p('three lines')))).toBe(
      'one\nline\n\nTWO\n\nthree\nlines\n'
    );
  });

  test('puts in blocks between, before and after the others', () => {
    expect(
      follow(text, doc(p('one line'), h(2, 'new'), p('two'), p('three lines')))
    ).toBe('one\nline\n\n## new\n\ntwo\n\nthree\nlines\n');
    expect(
      follow(text, doc(hr(), p('one line'), p('two'), p('three lines')))
    ).toBe('---\n\none\nline\n\ntwo\n\nthree\nlines\n');
    expect(
      follow(text, doc(p('one line'), p('two'), p('three lines'), ul('a', 'b')))
    ).toBe('one\nline\n\ntwo\n\nthree\nlines\n\n- a\n- b\n');
  });

  test('takes blocks out with the blank lines around them', () => {
    expect(follow(text, doc(p('one line'), p('three lines')))).toBe(
      'one\nline\n\nthree\nlines\n'
    );
    expect(follow(text, doc(p('two'), p('three lines')))).toBe(
      'two\n\nthree\nlines\n'
    );
    expect(follow(text, doc(p('one line'), p('two')))).toBe(
      'one\nline\n\ntwo\n'
    );
  });

  test('turns any document into another', () => {
    let seed = 3;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
    const block = () =>
      pick([
        () => p('a'),
        () => p('b c'),
        () => h(1, 'a'),
        () => ul('x', 'y'),
        () => code('z'),
        () => hr(),
      ])();
    for (let round = 0; round < 300; round++) {
      const blocks = Array.from({ length: 1 + Math.floor(next() * 5) }, block);
      // Soft line breaks the editor would write as spaces.
      const text = `${blocks
        .map((node) => {
          const written = serialize(doc(node)).trimEnd();
          return node.type.name === 'paragraph'
            ? written.replace(/ /g, '\n')
            : written;
        })
        .join('\n\n')}\n`;
      const before = parse(text);
      const list = children(before);
      for (let step = 0; step < 1 + Math.floor(next() * 3); step++) {
        const at = Math.floor(next() * (list.length + 1));
        const choice = next();
        if (choice < 0.4) list.splice(at, 0, block());
        else if (choice < 0.7 && list.length > 1) list.splice(at, 1);
        else if (at < list.length) list[at] = block();
      }
      follow(text, doc(...list));
    }
  });
});
