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

const codeSchema = new Schema({
  nodes: schema.spec.nodes,
  marks: { code: { code: true } },
});

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

  test('types it as text in inline code', () => {
    const code = codeSchema.text('设 $x', [codeSchema.mark('code')]);
    const doc = codeSchema.node('doc', null, [
      codeSchema.node('paragraph', null, code),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 5),
    });
    const match = '设 $x$'.match(TYPED_MATH);
    if (!match) throw new Error('no match');
    expect(keepDollar(state, match, 3, 5)?.doc.textContent).toBe('设 $x$');
  });

  test('types it as text when the math would open on a space', () => {
    expect(typeDollar('$ x')?.doc.textContent).toBe('$ x$');
  });

  test('types it as text across a line break', () => {
    const breakSchema = new Schema({
      nodes: schema.spec.nodes.addToEnd('hard_break', {
        group: 'inline',
        inline: true,
      }),
    });
    const doc = breakSchema.node('doc', null, [
      breakSchema.node('paragraph', null, [
        breakSchema.text('设 $a'),
        breakSchema.node('hard_break'),
        breakSchema.text('b'),
      ]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 7),
    });
    const typed = `${doc.textBetween(1, 7, null, '\ufffc')}$`;
    const match = typed.match(TYPED_MATH);
    if (!match) throw new Error('no match');
    const tr = keepDollar(state, match, 7 - (match[0].length - 1), 7);
    const line = tr?.doc.firstChild;
    expect(line?.childCount).toBe(3);
    expect(line?.child(1).type.name).toBe('hard_break');
    expect(line?.textContent).toBe('设 $ab$');
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
    for (const markdown of ['\\$x$ 不是公式\n', '公式 $x^2$ 和 $5\n']) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  test('keeps the escape of a dollar that would pair across a mark edge', () => {
    for (const markdown of [
      '**粗 \\$5** 和 $6\n',
      '先 \\$1 *斜 $2* 了\n',
      '[价 \\$1](https://a.com) 与 $2\n',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
    }
  });

  test('keeps a link or picture with a dollar in it whole', () => {
    for (const markdown of [
      '价格 \\$5 见 ![x$y](u.png)\n',
      '价格 \\$5 见 [链接](https://x.com/?q=$y)\n',
      '\\$5 和 [a $b$ c](u) $\n',
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
      expect(roundTrip(roundTrip(markdown))).toBe(markdown);
    }
  });

  test('escapes a dollar in text before a mark when the line has math', () => {
    expect(roundTrip('\\$a **b** $c$\n')).toBe('\\$a **b** $c$\n');
  });
});
