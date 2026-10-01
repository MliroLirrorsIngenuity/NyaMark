import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import {
  endsInClosingFence,
  leaveCodeAt,
} from '../src/editor/plugins/code-fence-exit';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { language: { default: '' } },
    },
    text: { group: 'inline' },
  },
});

const p = (text: string) =>
  schema.node('paragraph', null, text ? schema.text(text) : []);
const code = (text: string) =>
  schema.node('code_block', null, text ? schema.text(text) : []);
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

describe('endsInClosingFence', () => {
  test('a fence or $$ on the last line', () => {
    expect(endsInClosingFence('let a\n```', false)).toBe(true);
    expect(endsInClosingFence('let a\n  ~~~~ ', false)).toBe(true);
    expect(endsInClosingFence('```', false)).toBe(true);
    expect(endsInClosingFence('x^2\n$$', true)).toBe(true);
  });

  test('anything else on the last line', () => {
    expect(endsInClosingFence('let a\n```js', false)).toBe(false);
    expect(endsInClosingFence('let a = `x`', false)).toBe(false);
    expect(endsInClosingFence('x^2\n```', true)).toBe(false);
    expect(endsInClosingFence('let a\n$$', false)).toBe(false);
  });

  test('a fence closing one opened in the code', () => {
    expect(endsInClosingFence('```js\nlet a\n```', false)).toBe(false);
    expect(endsInClosingFence('```js\nlet a\n```\n```', false)).toBe(true);
  });
});

describe('leaveCodeAt', () => {
  test('drops the fence line and opens a line under the block', () => {
    const start = doc(p('a'), code('let a\n```'), p('b'));
    const tr = leaveCodeAt(EditorState.create({ doc: start }), 3, 5);
    expect(tr?.doc.toJSON()).toEqual(
      doc(p('a'), code('let a'), p(''), p('b')).toJSON()
    );
    expect(tr?.selection.$from.parent.content.size).toBe(0);
    expect(tr?.selection.from).toBe(3 + 'let a'.length + 3);
  });

  test('uses an empty line already under the block', () => {
    const start = doc(code('```'), p(''));
    const tr = leaveCodeAt(EditorState.create({ doc: start }), 0, 0);
    expect(tr?.doc.toJSON()).toEqual(doc(code(''), p('')).toJSON());
    expect(tr?.selection.from).toBe(3);
  });
});
