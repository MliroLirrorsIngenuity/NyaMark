import { describe, expect, test } from 'bun:test';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Transaction } from '@codemirror/state';
import { continueMarkup } from '../src/editor/source-list-exit';
import { sourceMarkdown } from '../src/editor/source-syntax';

const open = (doc: string) =>
  EditorState.create({ doc, extensions: [sourceMarkdown(doc)] });

/** Each node of `state`'s tree, as `Name text`. */
function nodes(state: EditorState): string[] {
  const out: string[] = [];
  ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({
    enter: (node) => {
      out.push(`${node.name} ${state.doc.sliceString(node.from, node.to)}`);
    },
  });
  return out;
}

const names = (doc: string) =>
  nodes(open(doc)).map((node) => node.split(' ')[0]);

describe('front matter', () => {
  test('reads as front matter, its lines no heading', () => {
    for (const doc of [
      '---\ntitle: x\n---\n# H\n',
      '--- \ntitle: x\n---  \n# H\n',
      '+++\na = 1\n+++\n# H\n',
      '---\n---\n# H\n',
    ]) {
      expect(names(doc)).toEqual([
        'Document',
        'FrontMatter',
        'FrontMatterMark',
        ...(doc.startsWith('---\n---') ? [] : ['FrontMatterText']),
        'FrontMatterMark',
        'ATXHeading1',
        'HeaderMark',
      ]);
    }
  });

  test('is none without a fence to close it, or below the first line', () => {
    expect(names('---\ntitle: x\n\n# H\n')).not.toContain('FrontMatter');
    expect(names('---\na\n+++\n')).not.toContain('FrontMatter');
    expect(names('# A\n---\nb\n---\n')).not.toContain('FrontMatter');
  });

  test('comes and goes with the fence that closes it', () => {
    const state = open('---\ntitle: x\n\n# H\n');
    const closed = state.update({
      changes: { from: 13, insert: '---\n' },
    }).state;
    expect(names(closed.doc.toString())).toContain('FrontMatter');
    expect(nodes(closed)).toContain('FrontMatter ---\ntitle: x\n---');
    const opened = closed.update({ changes: { from: 13, to: 17 } }).state;
    expect(nodes(opened).some((node) => node.startsWith('FrontMatter'))).toBe(
      false
    );
  });
});

describe('formulas', () => {
  test('a formula between `$$` lines holds no Markdown', () => {
    expect(nodes(open('$$\n# x *y*\n$$\nafter'))).toEqual([
      'Document $$\n# x *y*\n$$\nafter',
      'BlockMath $$\n# x *y*\n$$',
      'MathMark $$',
      'MathText # x *y*',
      'MathMark $$',
      'Paragraph after',
    ]);
    expect(names('a\n$$\nx\n$$')).toEqual([
      'Document',
      'Paragraph',
      'BlockMath',
      'MathMark',
      'MathText',
      'MathMark',
    ]);
    expect(names('$$\n# x')).not.toContain('ATXHeading1');
    expect(names('$$ a $ b\n# c')).toContain('ATXHeading1');
  });

  test('a formula between dollars holds no Markdown', () => {
    expect(nodes(open('a $x*y*z$ b'))).toContain('InlineMath $x*y*z$');
    expect(names('a $x*y*z$ b')).not.toContain('Emphasis');
    expect(nodes(open('$ x $ and $$y$$'))).toEqual([
      'Document $ x $ and $$y$$',
      'Paragraph $ x $ and $$y$$',
      'InlineMath $ x $',
      'MathMark $',
      'MathMark $',
      'InlineMath $$y$$',
      'MathMark $$',
      'MathMark $$',
    ]);
    expect(nodes(open('\\$$x$'))).toContain('InlineMath $x$');
    expect(names('$$\\$x$')).not.toContain('InlineMath');
  });

  test('dollars around a space at either end stay text, as in the editor', () => {
    expect(names('价格 $5 和 $10')).not.toContain('InlineMath');
    expect(names('价格 $5 和 $10$')).not.toContain('InlineMath');
    expect(names('$5 and **b** $10')).toContain('StrongEmphasis');
    expect(nodes(open('$5 和 $10 和 $x$'))).toContain('InlineMath $x$');
  });

  test('in a list, a formula on a line reads between its dollars', () => {
    expect(names('- $$\n  x^2\n  $$\n- b')).not.toContain('BlockMath');
    expect(nodes(open('- a $x_1$'))).toContain('InlineMath $x_1$');
  });
});

test('Enter goes on with a list under front matter', () => {
  const doc = '---\na: 1\n---\n- a';
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [sourceMarkdown(doc)],
  });
  let next: Transaction | null = null;
  continueMarkup({
    state,
    dispatch: (tr) => {
      next = tr;
    },
  });
  expect((next as Transaction | null)?.state.doc.toString()).toBe(`${doc}\n- `);
});
