import { afterEach, describe, expect, test } from 'bun:test';
import { EditorState as SourceState } from '@codemirror/state';
import { history, undo } from '@milkdown/kit/prose/history';
import type { Node } from '@milkdown/kit/prose/model';
import {
  EditorState,
  type Plugin,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  SUGGEST_MAX,
  cleanSuggestion,
  replyDone,
  suggestPrompt,
  visibleReply,
} from '../src/ai/complete/prompt';
import { ORIGIN_META } from '../src/editor/plugins/ai-proposals';
import {
  spotIn,
  suggestPlugin,
  suggestionOf,
} from '../src/editor/plugins/ai-suggest';
import {
  showSuggestion,
  sourceSuggest,
  sourceSuggestionOf,
} from '../src/editor/source-suggest';
import {
  type SuggestSpot,
  nextWord,
  setSuggestDriver,
} from '../src/editor/suggest';
import { normalizeSettings } from '../src/state/settings';
import { code, doc, p } from './ai-edit-helpers';

type FakeView = {
  state: EditorState;
  editable: boolean;
  composing: boolean;
  focused: boolean;
  hasFocus(): boolean;
  dispatch(tr: Transaction): void;
};

function viewOf(start: Node, caret: number, head = caret) {
  const view: FakeView = {
    state: EditorState.create({
      doc: start,
      selection: TextSelection.create(start, caret, head),
      plugins: [history(), suggestPlugin()],
    }),
    editable: true,
    composing: false,
    focused: true,
    hasFocus() {
      return this.focused;
    },
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

const asView = (view: FakeView) => view as unknown as EditorView;

const pluginOf = (view: FakeView) =>
  view.state.plugins.find(
    (plugin) =>
      (plugin as Plugin & { key: string }).key === 'nyamark/ai-suggest$'
  ) as Plugin;

function spot(view: FakeView): SuggestSpot {
  const found = spotIn(asView(view));
  if (!found) throw new Error('no spot');
  return found;
}

function key(view: FakeView, name: string) {
  let prevented = false;
  const event = {
    key: name,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    preventDefault() {
      prevented = true;
    },
  } as unknown as KeyboardEvent;
  const handled = pluginOf(view).props.handleDOMEvents?.keydown?.call(
    pluginOf(view),
    asView(view),
    event
  );
  return { handled: !!handled, prevented };
}

const text = (view: FakeView) => view.state.doc.textContent;

afterEach(() => setSuggestDriver(null));

describe('suggestions in the editor', () => {
  test('read the paragraph up to the caret and show at it', () => {
    const view = viewOf(doc(p('First.'), p('Hello wor'), p('Last.')), 18);
    const found = spot(view);
    expect(found.before).toBe('First.\n\nHello wor');
    expect(found.after).toBe('\n\nLast.');
    expect(found.line).toBe('Hello wor');
    expect(found.atEnd).toBe(true);
    expect(found.markdown).toBe(false);
    found.show('ld');
    expect(suggestionOf(view.state)).toEqual({ pos: 18, text: 'ld' });
  });

  test('tell the caret in the middle of a paragraph', () => {
    const view = viewOf(doc(p('Hello there')), 6);
    const found = spot(view);
    expect(found.line).toBe('Hello');
    expect(found.atEnd).toBe(false);
  });

  test('go nowhere in code, over a selection, unfocused or beside one', () => {
    expect(spotIn(asView(viewOf(doc(code('let a')), 6)))).toBeNull();
    expect(spotIn(asView(viewOf(doc(p('Hello')), 1, 6)))).toBeNull();
    const away = viewOf(doc(p('Hello')), 6);
    away.focused = false;
    expect(spotIn(asView(away))).toBeNull();
    const shown = viewOf(doc(p('Hello')), 6);
    spot(shown).show(' world');
    expect(spotIn(asView(shown))).toBeNull();
  });

  test('show nothing once the text or the caret moved on', () => {
    const view = viewOf(doc(p('Hello')), 6);
    const found = spot(view);
    view.dispatch(view.state.tr.insertText('!'));
    found.show(' world');
    expect(suggestionOf(view.state)).toBeNull();
  });

  test('take typed letters off the front, and go at other ones', () => {
    const view = viewOf(doc(p('Hello')), 6);
    spot(view).show(' world again');
    view.dispatch(view.state.tr.insertText(' w'));
    expect(suggestionOf(view.state)).toEqual({ pos: 8, text: 'orld again' });
    view.dispatch(view.state.tr.insertText('x'));
    expect(suggestionOf(view.state)).toBeNull();
  });

  test('go when typed out, the caret moves or text is deleted', () => {
    const typed = viewOf(doc(p('Hello')), 6);
    spot(typed).show('!');
    typed.dispatch(typed.state.tr.insertText('!'));
    expect(suggestionOf(typed.state)).toBeNull();

    const moved = viewOf(doc(p('Hello')), 6);
    spot(moved).show(' world');
    moved.dispatch(
      moved.state.tr.setSelection(TextSelection.create(moved.state.doc, 3))
    );
    expect(suggestionOf(moved.state)).toBeNull();

    const deleted = viewOf(doc(p('Hello')), 6);
    spot(deleted).show(' world');
    deleted.dispatch(deleted.state.tr.delete(5, 6));
    expect(suggestionOf(deleted.state)).toBeNull();
  });

  test('move along with what another plugin changes after a key', () => {
    const view = viewOf(doc(p('A'), p('Hello')), 9);
    spot(view).show(' world');
    const typed = view.state.tr;
    view.dispatch(
      view.state.tr.insertText('Z', 1).setMeta('appendedTransaction', typed)
    );
    expect(suggestionOf(view.state)).toEqual({ pos: 10, text: ' world' });
  });

  test('Tab takes it in one undo step, Escape lets it go', () => {
    const view = viewOf(doc(p('Hello')), 6);
    expect(key(view, 'Tab').handled).toBe(false);
    spot(view).show(' world');
    expect(key(view, 'Tab')).toEqual({ handled: true, prevented: true });
    expect(text(view)).toBe('Hello world');
    expect(suggestionOf(view.state)).toBeNull();
    expect(view.state.selection.head).toBe(12);
    undo(view.state, view.dispatch);
    expect(text(view)).toBe('Hello');

    spot(view).show(' there');
    expect(key(view, 'Escape').handled).toBe(true);
    expect(suggestionOf(view.state)).toBeNull();
    expect(text(view)).toBe('Hello');
  });

  test('tell the driver of typing and moving, and of nothing else', () => {
    const calls: boolean[] = [];
    setSuggestDriver({
      changed: (_spot, typed) => calls.push(typed),
      stop: () => {},
    });
    const view = viewOf(doc(p('Hello'), p('World')), 6);
    const watcher = pluginOf(view).spec.view?.(asView(view));
    const step = (tr: Transaction) => {
      const previous = view.state;
      view.dispatch(tr);
      watcher?.update?.(asView(view), previous);
    };
    step(view.state.tr.insertText('!'));
    step(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    step(view.state.tr.insertText('?', 13).setMeta(ORIGIN_META, 'reload'));
    step(view.state.tr.insertText('.', 13).setMeta('addToHistory', false));
    step(view.state.tr.setMeta('nothing', true));
    expect(calls).toEqual([true, false]);
  });
});

describe('suggestions in the source pane', () => {
  const sourceOf = (text: string) =>
    SourceState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [sourceSuggest()],
    });

  test('take typed letters off the front and go at anything else', () => {
    let state = sourceOf('Hello');
    state = state.update({
      effects: showSuggestion.of({ pos: 5, text: ' world' }),
    }).state;
    expect(sourceSuggestionOf(state)).toEqual({ pos: 5, text: ' world' });
    state = state.update({
      changes: { from: 5, insert: ' w' },
      selection: { anchor: 7 },
    }).state;
    expect(sourceSuggestionOf(state)).toEqual({ pos: 7, text: 'orld' });
    state = state.update({ selection: { anchor: 2 } }).state;
    expect(sourceSuggestionOf(state)).toBeNull();
  });
});

describe('the suggestion asked for', () => {
  test('carries the text either side and the way it is written', () => {
    const shown = suggestPrompt(
      {
        title: 'notes.md',
        before: 'Hello',
        after: ' and more',
        markdown: false,
      },
      ''
    );
    expect(shown.instructions).toContain('no Markdown marks');
    expect(shown.prompt).toContain('"notes.md"');
    expect(shown.prompt).toContain('<before_caret>\nHello\n</before_caret>');
    expect(shown.prompt).toContain('<after_caret>\n and more\n</after_caret>');

    const source = suggestPrompt(
      { title: null, before: 'x'.repeat(5000), after: '\n', markdown: true },
      'Write in British English.'
    );
    expect(source.instructions).toContain('Markdown source');
    expect(source.instructions).toContain('Write in British English.');
    expect(source.prompt).not.toContain('<after_caret>');
    expect(source.prompt).toContain(`\n${'x'.repeat(4000)}\n`);
    expect(source.prompt).not.toContain('x'.repeat(4001));
  });

  test('stops at the end of a line, after any thinking', () => {
    expect(replyDone('fox jumps')).toBe(false);
    expect(replyDone('fox jumps\n')).toBe(true);
    expect(replyDone('\n')).toBe(false);
    expect(replyDone('<think>one\ntwo\n')).toBe(false);
    expect(replyDone('<think>a</think>\n\nfox\n')).toBe(true);
    expect(replyDone('x'.repeat(SUGGEST_MAX * 2 + 1))).toBe(true);
    expect(visibleReply('<think>a')).toBeNull();
    expect(visibleReply('<think>a</think>\n\nfox')).toBe('fox');
  });
});

describe('the suggestion shown', () => {
  test('keeps the first line, and none that opens a new paragraph', () => {
    expect(cleanSuggestion('fox jumps.\nMore', 'The quick brown ', '')).toBe(
      'fox jumps.'
    );
    expect(cleanSuggestion('\n\nNext one.', 'The end.', '')).toBe('');
    expect(cleanSuggestion('```\nfoo bar\n```', 'Say ', '')).toBe('foo bar');
    expect(cleanSuggestion('<think>hm</think>\n\n lazy dog', 'the ', '')).toBe(
      'lazy dog'
    );
    expect(cleanSuggestion('   ', 'the ', '')).toBe('');
  });

  test('drops the sentence typed so far written out again', () => {
    expect(
      cleanSuggestion('The quick brown fox', 'Once more. The quick bro', '')
    ).toBe('wn fox');
    // A short run alike is the model's own words.
    expect(cleanSuggestion('a cat', 'I saw a', '')).toBe('a cat');
  });

  test('drops what already follows the caret', () => {
    expect(cleanSuggestion('sat on the mat.', 'The cat ', '.')).toBe(
      'sat on the mat'
    );
    expect(cleanSuggestion('sat on the', 'The cat ', 'the end')).toBe(
      'sat on '
    );
    expect(cleanSuggestion('una', 'Es ', 'a b')).toBe('una');
  });

  test('puts in the space a word needs after a stop', () => {
    expect(cleanSuggestion('It was late.', 'He left.', '')).toBe(
      ' It was late.'
    );
    expect(cleanSuggestion('world', 'Hello,', '')).toBe(' world');
    expect(cleanSuggestion('14', 'Pi is 3.', '')).toBe('14');
    expect(cleanSuggestion('com', 'See example.', '')).toBe('com');
    expect(cleanSuggestion('wn fox', 'The quick bro', '')).toBe('wn fox');
    expect(cleanSuggestion(' 很好', '今天天气', '')).toBe('很好');
    expect(cleanSuggestion(' Python', '我常用', '')).toBe(' Python');
    expect(cleanSuggestion('天气不错', '今天。', '')).toBe('天气不错');
  });

  test('stops at a word short of the longest', () => {
    const long = cleanSuggestion('word '.repeat(80), 'A ', '');
    expect(long.length).toBeLessThanOrEqual(SUGGEST_MAX);
    expect(long.endsWith('word')).toBe(true);
  });

  test('is taken a word at a time', () => {
    expect(nextWord('hello world')).toBe('hello');
    expect(nextWord(' world again')).toBe(' world');
    expect(nextWord(', then')).toBe(',');
    expect(nextWord('   ')).toBe('   ');
    const chinese = nextWord('今天天气很好');
    expect(chinese.length).toBeGreaterThan(0);
    expect(chinese.length).toBeLessThan(6);
    expect('今天天气很好'.startsWith(chinese)).toBe(true);
  });
});

describe('suggestion settings', () => {
  test('start off, after a short pause, at the end of a paragraph', () => {
    const { ai } = normalizeSettings(undefined);
    expect(ai.completeModel).toBeNull();
    expect(ai.complete).toEqual({
      enabled: false,
      delay: 700,
      atEndOnly: true,
    });
  });

  test('keep a pause offered, the nearest one to any other', () => {
    const delay = (value: unknown) =>
      normalizeSettings({ ai: { complete: { delay: value } } } as never).ai
        .complete.delay;
    expect(delay(1500)).toBe(1500);
    expect(delay(650)).toBe(700);
    expect(delay(10)).toBe(300);
    expect(delay(99_999)).toBe(2000);
    expect(delay('500')).toBe(700);
    expect(delay(null)).toBe(700);
    expect(
      normalizeSettings({
        ai: { complete: { enabled: true, atEndOnly: 0 } },
      } as never).ai.complete
    ).toEqual({ enabled: true, delay: 700, atEndOnly: true });
  });

  test('keep their model only while it is there', () => {
    const providers = [
      {
        id: 'p-1',
        name: 'Local',
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'qwen3' }],
      },
    ];
    const model = (ref: unknown) =>
      normalizeSettings({ ai: { providers, completeModel: ref } } as never).ai
        .completeModel;
    expect(model({ provider: 'p-1', model: 'qwen3' })).toEqual({
      provider: 'p-1',
      model: 'qwen3',
    });
    expect(model({ provider: 'p-1', model: 'gone' })).toBeNull();
  });
});
