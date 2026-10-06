import { afterAll, expect, test } from 'bun:test';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseHTML } from 'linkedom';
import { headingIds } from '../src/editor/heading-anchor';

// Milkdown in a page of linkedom's, with the heading ids kept by
// `headingIds` in place of Milkdown's own plugin.
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

async function open(markdown: string) {
  Object.assign(globalThis, stand);
  Object.assign(page.document, { getSelection: () => null });
  const { Editor, defaultValueCtx, editorViewCtx, rootCtx } = await import(
    '@milkdown/kit/core'
  );
  const { commonmark, syncHeadingIdPlugin } = await import(
    '@milkdown/kit/preset/commonmark'
  );
  const root = page.document.createElement('div');
  page.document.body.append(root);
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(headingIds);
  await editor.remove(syncHeadingIdPlugin);
  await editor.create();
  const view: EditorView = editor.ctx.get(editorViewCtx);
  return { view, close: () => editor.destroy() };
}

const ids = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll('h1, h2'), (heading) => heading.id);

test('the headings on the page have the anchors GitHub gives them', async () => {
  const { view, close } = await open('# Hello, World!\n\n## 用法\n\n## 用法\n');
  expect(ids(view)).toEqual(['hello-world', '用法', '用法-1']);

  // A heading typed in before the others takes the name, and they move on.
  const { tr } = view.state;
  view.dispatch(
    tr.insert(
      0,
      view.state.schema.nodes.heading.create(
        { level: 2 },
        view.state.schema.text('用法')
      )
    )
  );
  expect(ids(view)).toEqual(['用法', 'hello-world', '用法-1', '用法-2']);
  await close();
});
