import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { EditorView } from '@codemirror/view';
import { parseHTML } from 'linkedom';
import en from '../src/i18n/locales/en.json';

const page = parseHTML(
  '<!doctype html><html><body><div id="ny-app"></div></body></html>'
);
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

// CodeMirror reads the page it runs in when it loads; linkedom keeps no
// caret or focus.
Object.assign(globalThis, stand);
Object.assign(page.document, {
  getSelection: () => null,
  hasFocus: () => false,
});
const { EditorState } = await import('@codemirror/state');
const { EditorView: CodeMirror } = await import('@codemirror/view');
const { i18next } = await import('../src/i18n');
const { bindSourceBar } = await import('../src/editor/source-bar');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

let view: EditorView | undefined;
bindSourceBar(() => view ?? null);

beforeEach(() => {
  view?.destroy();
  view = new CodeMirror({
    state: EditorState.create({ doc: 'ab', selection: { anchor: 1 } }),
    parent: page.document.body,
  });
});

const bar = () => page.document.getElementById('ny-source-bar') as HTMLElement;

function button(name: string) {
  const found = Array.from(bar().querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

/** A finger that goes down on `target`, moves `drift` px sideways and lifts. */
function touch(target: Element, drift = 0) {
  const fire = (type: string, x: number) => {
    const event = new page.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(event, { clientX: x, clientY: 0, pointerType: 'touch' });
    target.dispatchEvent(event);
    return event;
  };
  const down = fire('pointerdown', 100);
  fire('pointermove', 100 + drift);
  fire('pointerup', 100 + drift);
  return down;
}

describe('the source mode bar', () => {
  test('a tap inserts its symbol at the caret and keeps the keyboard up', () => {
    const down = touch(button('Insert “#”'));
    expect(view.state.doc.toString()).toBe('a#b');
    expect(view.state.selection.main.head).toBe(2);
    expect(down.defaultPrevented).toBe(true);
  });

  test('a finger that scrolls the bar inserts nothing', () => {
    touch(button('Insert “#”'), 20);
    expect(view.state.doc.toString()).toBe('ab');
  });

  test('buttons are named for what they do', () => {
    expect(bar().getAttribute('role')).toBe('toolbar');
    expect(bar().getAttribute('aria-label')).toBe('Formatting');
    expect(button('Undo')).toBeDefined();
    expect(button('Decrease Indent')).toBeDefined();
  });
});
