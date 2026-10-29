import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import type { EditorView } from '@codemirror/view';
import { parseHTML } from 'linkedom';
import type { NyaEditor } from '../src/editor/editor';
import type { SourceModeController } from '../src/editor/source-mode';
import en from '../src/i18n/locales/en.json';

type Sent = { type: string; panel?: string; op?: string } & Record<
  string,
  unknown
>;

const page = parseHTML(
  '<!doctype html><html><head></head><body><div id="ny-app"></div></body></html>'
);
const sent: Sent[] = [];
Object.assign(page.window, {
  __NYAMARK_PLATFORM__: 'ios',
  __NYAMARK_NATIVE_SHELL__: true,
  webkit: {
    messageHandlers: { nyamark: { postMessage: (m: Sent) => sent.push(m) } },
  },
});
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
const { closeSearchPanel, searchPanelOpen } = await import(
  '@codemirror/search'
);
const { i18next } = await import('../src/i18n');
const { store } = await import('../src/state/store');
const { bindNativeFind } = await import('../src/features/native/find');
const { dispatchPanel } = await import('../src/features/native/panels');
const { matchStatus, replaceAllWith, replaceWith, searchSource, sourceSearch } =
  await import('../src/editor/source-search');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

function fakeEditor() {
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const editor = {
    calls,
    listeners,
    selected: '',
    status: { current: 0, total: 0 },
    search: (query: string, direction: string) => {
      calls.push(`search ${query} ${direction}`);
    },
    searchStatus: () => editor.status,
    endSearch: () => {
      calls.push('end');
    },
    selectedLine: () => editor.selected,
    onDocChanged: (callback: () => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return editor;
}

/** A source pane on a real CodeMirror view, driven as the controller drives it. */
function sourcePane(view: EditorView) {
  return {
    active: true,
    isActive() {
      return this.active;
    },
    search: (query: string, direction: 'first' | 'next' | 'prev') =>
      searchSource(view, query, direction),
    searchStatus: () => matchStatus(view),
    endSearch: () => closeSearchPanel(view),
    selectedLine: () => '',
    replace: (text: string) => replaceWith(view, text),
    replaceAll: (text: string) => replaceAllWith(view, text),
  };
}

const tell = (op: string, data: Record<string, unknown> = {}) =>
  dispatchPanel({ type: 'panel', panel: 'find', op, ...data });
const states = () =>
  sent.filter((message) => message.panel === 'find' && message.op === 'state');
const lastState = () =>
  states().at(-1) as Sent & {
    query: string;
    count: string;
    source: boolean;
    labels: Record<string, string>;
  };

let editor = fakeEditor();
let source: ReturnType<typeof sourcePane> | null = null;

beforeEach(() => {
  sent.length = 0;
  editor = fakeEditor();
  source = null;
  bindNativeFind({
    editor: () => editor as unknown as NyaEditor,
    sourceMode: () => source as unknown as SourceModeController | null,
  });
});

afterEach(async () => {
  await tell('close');
  store.update({ sourceMode: false });
});

describe('the native find bar, in the document', () => {
  test('opens on the selected line, searching it first and sending its count', async () => {
    editor.selected = 'needle';
    editor.status = { current: 1, total: 3 };
    await tell('open');
    expect(editor.calls).toEqual(['search needle first']);
    expect(lastState()).toMatchObject({
      query: 'needle',
      count: '1/3',
      source: false,
    });
    expect(lastState().labels.placeholder).toBe('Find…');
    expect(lastState().labels.next).toBe('Next match');
  });

  test('opens empty with nothing selected, and says nothing of matches', async () => {
    await tell('open');
    expect(editor.calls).toEqual([]);
    expect(lastState()).toMatchObject({ query: '', count: '' });
  });

  test('next and prev step from the current match', async () => {
    editor.selected = 'needle';
    editor.status = { current: 1, total: 3 };
    await tell('open');
    editor.calls.length = 0;
    editor.status = { current: 2, total: 3 };
    await tell('next');
    editor.status = { current: 1, total: 3 };
    await tell('prev');
    expect(editor.calls).toEqual(['search needle next', 'search needle prev']);
    expect(lastState().count).toBe('1/3');
  });

  test('typing searches from the first match, and an empty query shows no count', async () => {
    await tell('open');
    editor.status = { current: 1, total: 2 };
    await tell('query', { text: 'hay' });
    expect(editor.calls).toEqual(['search hay first']);
    expect(lastState()).toMatchObject({ query: 'hay', count: '1/2' });
    await tell('query', { text: '' });
    expect(editor.calls.at(-1)).toBe('search  first');
    expect(lastState().count).toBe('');
  });

  test('counts no matches and a match not yet stepped to as the panel does', async () => {
    await tell('open');
    editor.status = { current: 0, total: 0 };
    await tell('query', { text: 'zzz' });
    expect(lastState().count).toBe('No results');
    editor.status = { current: 0, total: 4 };
    await tell('query', { text: 'a' });
    expect(lastState().count).toBe('?/4');
  });

  test('follows edits to the document while open', async () => {
    editor.selected = 'needle';
    editor.status = { current: 1, total: 1 };
    await tell('open');
    editor.status = { current: 1, total: 2 };
    for (const changed of editor.listeners) changed();
    expect(lastState().count).toBe('1/2');
  });

  test('closing ends the search and stops following the document', async () => {
    editor.selected = 'needle';
    await tell('open');
    await tell('close');
    expect(editor.calls.at(-1)).toBe('end');
    expect(editor.listeners.size).toBe(0);
    const before = sent.length;
    await tell('next');
    expect(sent.length).toBe(before);
  });
});

describe('the native find bar, in the source pane', () => {
  let view: EditorView;

  beforeEach(() => {
    view = new CodeMirror({
      state: EditorState.create({
        doc: 'Foo bar foo\nfoo baz',
        extensions: [sourceSearch()],
      }),
      parent: page.document.body,
    });
    source = sourcePane(view);
    store.update({ sourceMode: true });
  });

  afterEach(async () => {
    await tell('close');
    view.destroy();
  });

  test('counts the matches of the pane and steps through them', async () => {
    await tell('open');
    await tell('query', { text: 'foo' });
    expect(matchStatus(view)).toEqual({ current: 1, total: 3 });
    expect(lastState()).toMatchObject({
      query: 'foo',
      count: '1/3',
      source: true,
    });
    await tell('next');
    expect(lastState().count).toBe('2/3');
    await tell('prev');
    await tell('prev');
    expect(lastState().count).toBe('3/3');
  });

  test('replaces one match, then every match', async () => {
    await tell('open');
    await tell('query', { text: 'foo' });
    await tell('replace', { text: 'qux' });
    expect(view.state.doc.toString()).toBe('qux bar foo\nfoo baz');
    expect(lastState().count).toBe('?/2');
    await tell('replaceAll', { text: 'qux' });
    expect(view.state.doc.toString()).toBe('qux bar qux\nqux baz');
    expect(lastState().count).toBe('No results');
  });

  test('closing drops the highlights and leaves the match selected', async () => {
    await tell('open');
    await tell('query', { text: 'bar' });
    expect(searchPanelOpen(view.state)).toBe(true);
    await tell('close');
    expect(searchPanelOpen(view.state)).toBe(false);
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('bar');
  });

  test('switching modes runs the query in the other mode', async () => {
    source = null;
    store.update({ sourceMode: false });
    editor.selected = 'needle';
    editor.status = { current: 1, total: 2 };
    await tell('open');
    expect(lastState().source).toBe(false);
    editor.calls.length = 0;
    source = sourcePane(view);
    store.update({ sourceMode: true });
    expect(editor.calls).toEqual(['end']);
    expect(lastState()).toMatchObject({ query: 'needle', source: true });
  });
});
