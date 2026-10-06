import { afterAll, describe, expect, test } from 'bun:test';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseHTML } from 'linkedom';
import { mathInlineKeys } from '../src/editor/plugins/math-inline-keys';

// Crepe in a page of linkedom's, for the box a formula in a line is edited
// in. Vue takes the document there is as it loads, so Crepe is loaded once
// the page is in place.
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
const { prototype: range } = page.document.createRange().constructor;
Object.assign(range, { collapse() {} });
Object.assign(page.Element.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
});

/** Each element given focus, in turn. */
const focused: Element[] = [];
const focus = page.HTMLElement.prototype.focus;
page.HTMLElement.prototype.focus = function (this: HTMLElement) {
  focused.push(this);
  focus.call(this);
};

const BOX = '.milkdown-latex-inline-edit';

async function open(markdown: string) {
  Object.assign(globalThis, stand);
  // linkedom keeps no selection, and KaTeX draws only in standards mode.
  Object.assign(page.document, { getSelection: () => null });
  Object.defineProperty(page.document, 'compatMode', { value: 'CSS1Compat' });
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
  crepe.editor.use(mathInlineKeys);
  await crepe.create();
  const view = crepe.editor.ctx.get(editorViewCtx);
  const close = async () => {
    await crepe.destroy();
    root.remove();
  };
  return { view, close };
}

/** Where the first formula in the document is. */
function formulaAt(view: EditorView) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'math_inline') at = pos;
    return at < 0;
  });
  return at;
}

function click(view: EditorView, at: number) {
  const node = view.state.doc.nodeAt(at);
  if (!node) throw new Error('no node there');
  const event = new page.window.Event('mouseup') as unknown as MouseEvent;
  return view.someProp('handleClickOn', (handle) =>
    handle(view, at, node, at, event, true)
  );
}

/** The editor in the box the source is shown in, when it has the focus. */
function sourceFocused(view: EditorView) {
  const last = focused.at(-1);
  const box = view.dom.parentElement?.querySelector(BOX);
  return Boolean(last && box?.contains(last) && last.matches('.ProseMirror'));
}

const settled = () => new Promise((done) => setTimeout(done));

describe('a click on a formula', () => {
  test('selects it and goes on into its source once the box has it', async () => {
    const { view, close } = await open('设 $x^2$ 后');
    const at = formulaAt(view);
    focused.length = 0;
    expect(click(view, at)).toBe(true);
    const { selection } = view.state;
    expect(selection instanceof NodeSelection && selection.from).toBe(at);
    await settled();
    expect(sourceFocused(view)).toBe(true);
    await close();
  });

  test('goes into the source of the formula already selected', async () => {
    const { view, close } = await open('设 $x^2$ 后');
    const at = formulaAt(view);
    const { state } = view;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)));
    await settled();
    focused.length = 0;
    click(view, at);
    expect(sourceFocused(view)).toBe(true);
    await close();
  });
});

describe('a formula selected from the keyboard', () => {
  test('shows its source and leaves the caret in the line', async () => {
    const { view, close } = await open('设 $x^2$ 后');
    const at = formulaAt(view);
    focused.length = 0;
    const { state } = view;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)));
    await settled();
    const box = view.dom.parentElement?.querySelector(BOX);
    expect(box?.querySelector('.ProseMirror')).toBeTruthy();
    expect(sourceFocused(view)).toBe(false);
    await close();
  });
});
