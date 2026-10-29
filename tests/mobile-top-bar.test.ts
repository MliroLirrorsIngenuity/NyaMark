import { afterAll, describe, expect, test } from 'bun:test';
import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseHTML } from 'linkedom';

// Crepe in a page of linkedom's, loaded once the page is in place since Vue
// takes the document as it loads.
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

// linkedom lays nothing out and keeps no caret.
Object.assign(globalThis, stand);
Object.assign(page.document, { getSelection: () => null });
Object.defineProperty(page.document, 'compatMode', { value: 'CSS1Compat' });
Object.assign(page.Element.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
});

const { Crepe, CrepeFeature } = await import('@milkdown/crepe');
const { editorViewCtx } = await import('@milkdown/kit/core');
const { TextSelection } = await import('@milkdown/kit/prose/state');
const { markdownOutput, writeAsNotes } = await import(
  '../src/editor/plugins/markdown-output'
);
const { intoMobileBar } = await import('../src/editor/plugins/mobile-top-bar');

type Bar = {
  key: string;
  items: { key: string; onRun?: (ctx: Ctx) => void }[];
}[];

const FEATURES: string[] = [
  CrepeFeature.TopBar,
  CrepeFeature.Table,
  CrepeFeature.ImageBlock,
  CrepeFeature.Latex,
  CrepeFeature.CodeMirror,
  CrepeFeature.ListItem,
];

/** Crepe with the phone's bar built, and handles to press its buttons. */
async function open(markdown: string) {
  const root = page.document.createElement('div');
  page.document.body.append(root);
  let bar: Bar = [];
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: Object.fromEntries(
      Object.values(CrepeFeature).map((name) => [name, FEATURES.includes(name)])
    ),
    featureConfigs: {
      [CrepeFeature.TopBar]: {
        buildTopBar: (builder) => {
          intoMobileBar(builder);
          bar = builder.build();
        },
      },
    },
  });
  crepe.editor.config(writeAsNotes);
  crepe.editor.use(markdownOutput);
  await crepe.create();
  const { ctx } = crepe.editor;
  const view = ctx.get(editorViewCtx);
  const select = (anchor: number, head = anchor) =>
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, anchor, head)
      )
    );
  return {
    bar,
    view,
    select,
    markdown: () => crepe.getMarkdown(),
    press: (key: string) => {
      const item = bar
        .flatMap((group) => group.items)
        .find((candidate) => candidate.key === key);
      if (!item?.onRun) throw new Error(`No button ${key}`);
      item.onRun(ctx);
    },
    caretAtEndOf: (text: string) => {
      let end = -1;
      view.state.doc.descendants((node, pos) => {
        if (end < 0 && node.isTextblock && node.textContent === text) {
          end = pos + 1 + text.length;
        }
        return end < 0;
      });
      select(end);
    },
    close: async () => {
      await crepe.destroy();
      root.remove();
    },
  };
}

describe('the phone format bar', () => {
  test('groups its buttons for typing with thumbs', async () => {
    const { bar, close } = await open('text');
    const layout = bar.map((group) => [
      group.key,
      group.items.map((item) => item.key),
    ]);
    expect(layout).toEqual([
      ['history', ['undo', 'redo']],
      [
        'block',
        [
          'heading',
          'bullet-list',
          'task-list',
          'ordered-list',
          'indent',
          'outdent',
        ],
      ],
      ['formatting', ['bold', 'italic', 'strikethrough', 'code', 'link']],
      ['insert', ['image', 'table', 'code-block', 'math', 'quote', 'hr']],
      ['caret', ['caret-left', 'caret-right']],
    ]);
    await close();
  });
});

describe('the heading button', () => {
  const level = (view: EditorView) => {
    const { parent } = view.state.selection.$from;
    return parent.type.name === 'heading' ? parent.attrs.level : 0;
  };

  test('goes from body text to level 1, 2, 3 and back to body text', async () => {
    const { view, press, caretAtEndOf, close } = await open('text');
    caretAtEndOf('text');
    const levels = Array.from({ length: 4 }, () => {
      press('heading');
      return level(view);
    });
    expect(levels).toEqual([1, 2, 3, 0]);
    await close();
  });

  test('takes a deeper heading back to body text', async () => {
    const { view, press, caretAtEndOf, close } = await open('##### five');
    caretAtEndOf('five');
    press('heading');
    expect(level(view)).toBe(0);
    await close();
  });
});

describe('the indent buttons', () => {
  test('nest the second item under the first and bring it back', async () => {
    const { markdown, press, caretAtEndOf, close } = await open('- a\n- b\n');
    caretAtEndOf('b');
    press('indent');
    expect(markdown()).toBe('- a\n  - b\n');
    press('outdent');
    expect(markdown()).toBe('- a\n- b\n');
    await close();
  });
});

describe('the caret buttons', () => {
  test('left moves a caret back by one character', async () => {
    const { view, press, select, close } = await open('abc');
    select(3);
    press('caret-left');
    expect(view.state.selection.head).toBe(2);
    await close();
  });

  test('a selection collapses to its start on left and its end on right', async () => {
    const { view, press, select, close } = await open('abc');
    select(1, 3);
    press('caret-left');
    expect(view.state.selection.head).toBe(1);
    select(1, 3);
    press('caret-right');
    expect(view.state.selection.head).toBe(3);
    expect(view.state.selection.empty).toBe(true);
    await close();
  });
});
