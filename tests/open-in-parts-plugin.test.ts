import { afterAll, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { openInParts } from '../src/editor/open-in-parts';

// Milkdown in a page of linkedom's, started on a long text.
const page = parseHTML('<!doctype html><html><body></body></html>');
const stand = {
  window: page.window,
  document: page.document,
  navigator: page.navigator,
  Node: page.Node,
  Element: page.Element,
  HTMLElement: page.HTMLElement,
  MutationObserver: page.MutationObserver,
  getComputedStyle: () => ({}),
  getSelection: () => null,
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

test('the editor starts on the opening its own parser reads', async () => {
  Object.assign(globalThis, stand);
  Object.assign(page.document, { getSelection: () => null });
  const { Editor, defaultValueCtx, editorViewCtx, rootCtx } = await import(
    '@milkdown/kit/core'
  );
  const { commonmark } = await import('@milkdown/kit/preset/commonmark');
  const markdown = Array.from(
    { length: 400 },
    (_, index) => `${index} ${'x'.repeat(95)}`
  ).join('\n\n');
  let told: string | null | undefined;
  const root = page.document.createElement('div');
  page.document.body.append(root);
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(
      openInParts((opening) => {
        told = opening;
      })
    );
  await editor.create();
  const { doc } = editor.ctx.get(editorViewCtx).state;
  expect(told).toBeString();
  expect(markdown.startsWith(told ?? '-')).toBe(true);
  expect(told?.length).toBeLessThan(markdown.length / 2);
  expect(doc.childCount).toBe((told ?? '').trim().split('\n\n').length);
  await editor.destroy();
});
