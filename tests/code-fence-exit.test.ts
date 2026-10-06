import { describe, expect, test } from 'bun:test';
import { type Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { closesAs, leaveCodeAt } from '../src/editor/plugins/code-fence-exit';

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

const remark = unified().use(remarkParse).use(remarkMath).use(remarkStringify);
const parse = (markdown: string) => remark.parse(markdown);

/** Whether `line`, typed under `value` in a code block or formula, closes it. */
function closes(value: string, line: string, type: 'code' | 'math' = 'code') {
  const saved = remark.stringify({ type: 'root', children: [{ type, value }] });
  return closesAs(saved, line, parse);
}

describe('closesAs', () => {
  test('the fence the block is saved between, indented three spaces at most', () => {
    expect(closes('let a', '```')).toBe(true);
    expect(closes('let a', '   ```  ')).toBe(true);
    expect(closes('', '```')).toBe(true);
    expect(closes('x^2', '$$', 'math')).toBe(true);
  });

  test('anything else on the last line', () => {
    expect(closes('let a', '    ```')).toBe(false);
    expect(closes('let a', '~~~')).toBe(false);
    expect(closes('let a', '```js')).toBe(false);
    expect(closes('let a', 'let a = `x`')).toBe(false);
    expect(closes('let a', '')).toBe(false);
    expect(closes('let a', '$$')).toBe(false);
    expect(closes('x^2', '```', 'math')).toBe(false);
  });

  test('a fence closing one opened in the code', () => {
    expect(closes('```js\nlet a', '```')).toBe(false);
    expect(closes('```js\nlet a\n```', '```')).toBe(false);
    expect(closes('```js\nlet a\n```', '````')).toBe(true);
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
