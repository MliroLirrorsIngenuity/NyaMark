import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  normalizeOutput,
  writeText,
} from '../src/editor/plugins/markdown-output';
import {
  TYPED_MATH,
  dollarText,
  keepDollar,
} from '../src/editor/plugins/math-dollars';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
});

/** A `$` typed at the end of a paragraph holding `before`. */
function typeDollar(before: string) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text(before)),
  ]);
  const end = before.length + 1;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, end),
  });
  const match = `${before}$`.match(TYPED_MATH);
  if (!match) return null;
  const start = end - (match[0].length - 1);
  return keepDollar(state, match, start, end);
}

type Tree = { type: string; value?: string; children?: Tree[] };

function parse(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkMath).use(dollarText);
  return processor.runSync(processor.parse(markdown), markdown) as Tree;
}

const inline = (markdown: string) =>
  (parse(markdown).children?.[0]?.children ?? []).map((node) => [
    node.type,
    node.value,
  ]);

/** Opened and saved again, as Milkdown with Crepe's math does it. */
function roundTrip(markdown: string) {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(dollarText)
      .use(remarkStringify, { handlers: { text: writeText } })
      .use(normalizeOutput)
      .processSync(markdown)
  );
}

describe('keepDollar', () => {
  test('types the dollar after a price as text', () => {
    const tr = typeDollar('价格 $5 和 ');
    expect(tr?.doc.textContent).toBe('价格 $5 和 $');
  });

  test('leaves a dollar right after one to the rule for math', () => {
    expect(typeDollar('设 $x')).toBeNull();
    expect(typeDollar('设 $x^2')).toBeNull();
  });

  test('types it as text when the math would open on a space', () => {
    expect(typeDollar('$ x')?.doc.textContent).toBe('$ x$');
  });
});

describe('dollarText', () => {
  test('turns two prices back into text', () => {
    expect(inline('价格 $5 和 $10 两种。')).toEqual([
      ['text', '价格 '],
      ['text', '$5 和 $'],
      ['text', '10 两种。'],
    ]);
  });

  test('keeps math that starts and ends on something else', () => {
    expect(inline('设 $x^2$ 为')).toEqual([
      ['text', '设 '],
      ['inlineMath', 'x^2'],
      ['text', ' 为'],
    ]);
  });

  test('keeps the padding the dollars were written with', () => {
    expect(inline('$ a  $')).toEqual([['text', '$ a  $']]);
  });
});

describe('dollars on save', () => {
  test('writes prices and shell variables as typed', () => {
    for (const markdown of [
      '价格 $5 和 $10 两种。\n',
      '只要 $5\n',
      'echo $HOME and $PATH\n',
      '价格 $5 和 $x$\n',
      '# 预算 $3 到 $4\n',
      '先 $1 **再** $2 也行\n',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  test('keeps the escapes of dollars that would make math', () => {
    for (const markdown of ['\\$x\\$ 不是公式\n', '公式 $x^2$ 和 \\$5\n']) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  test('escapes a dollar in text before a mark when the line has math', () => {
    expect(roundTrip('\\$a **b** $c$\n')).toBe('\\$a **b** $c$\n');
  });
});
