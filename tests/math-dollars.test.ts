import { afterAll, describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  normalizeOutput,
  writeText,
} from '../src/editor/plugins/markdown-output';
import {
  dollarText,
  dollarTextParse,
} from '../src/editor/plugins/math-dollars';

// Crepe in a page of linkedom's, for its rule for dollars as they are typed.
// Vue takes the document there is as it loads, so Crepe is loaded once the
// page is in place, and the test files each run on their own (`--isolate`).
const page = parseHTML('<!doctype html><html><body></body></html>');
const stand = {
  window: page.window,
  document: page.document,
  navigator: page.navigator,
  Node: page.Node,
  Element: page.Element,
  HTMLElement: page.HTMLElement,
  SVGElement: page.SVGElement ?? class {},
  MutationObserver: page.MutationObserver,
  getComputedStyle: () => ({}),
  requestAnimationFrame: (run: () => void) => setTimeout(run),
  cancelAnimationFrame: clearTimeout,
};
const had = Object.fromEntries(
  Object.keys(stand).map((key) => [key, Reflect.get(globalThis, key)])
);
afterAll(() => {
  for (const [key, value] of Object.entries(had)) {
    if (value === undefined) Reflect.deleteProperty(globalThis, key);
    else Reflect.set(globalThis, key, value);
  }
});

/**
 * The line in `markdown` after a `$` is typed at `at` in its text, or at its
 * end: its text, its formulas' values, the names of its other nodes.
 */
async function typeDollar(markdown: string, at?: number) {
  Object.assign(globalThis, stand);
  // linkedom keeps no selection.
  Object.assign(page.document, { getSelection: () => null });
  const { Crepe, CrepeFeature } = await import('@milkdown/crepe');
  const { editorViewCtx } = await import('@milkdown/kit/core');
  const root = page.document.createElement('div');
  page.document.body.append(root);
  const features = Object.fromEntries(
    Object.values(CrepeFeature).map((name) => [
      name,
      name === CrepeFeature.Latex || name === CrepeFeature.CodeMirror,
    ])
  );
  const crepe = new Crepe({ root, defaultValue: markdown, features });
  crepe.editor.use(dollarTextParse);
  await crepe.create();
  const view = crepe.editor.ctx.get(editorViewCtx);
  const line = view.state.doc.firstChild;
  const pos = 1 + (at ?? line?.content.size ?? 0);
  const handled = view.someProp('handleTextInput', (handle) =>
    handle(view, pos, pos, '$', () => view.state.tr.insertText('$', pos))
  );
  if (!handled) view.dispatch(view.state.tr.insertText('$', pos));
  const typed = view.state.doc.firstChild;
  const parts: (string | string[])[] = [];
  for (let index = 0; index < (typed?.childCount ?? 0); index += 1) {
    const node = typed?.child(index);
    if (node?.isText) parts.push(node.text ?? '');
    else if (node?.type.name === 'math_inline') parts.push([node.attrs.value]);
    else if (node) parts.push(node.type.name);
  }
  await crepe.destroy();
  root.remove();
  return parts;
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

describe('dollars typed', () => {
  test('make math of what opens as math', async () => {
    expect(await typeDollar('设 $x')).toEqual(['设 ', ['x']]);
    expect(await typeDollar('设 $x^2')).toEqual(['设 ', ['x^2']]);
  });

  test('stay text after a price', async () => {
    expect(await typeDollar('价格 $5 和 买', 8)).toEqual(['价格 $5 和 $买']);
  });

  test('stay text where the math would open on a space', async () => {
    expect(await typeDollar('$ x')).toEqual(['$ x$']);
  });

  test('stay text in inline code', async () => {
    expect(await typeDollar('`设 $x 后`', 4)).toEqual(['设 $x$ 后']);
  });

  test('leave a line break between them where it is', async () => {
    expect(await typeDollar('设 $a\\\nb')).toEqual([
      '设 $a',
      'hardbreak',
      'b$',
    ]);
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
