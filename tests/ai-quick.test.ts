import { afterEach, describe, expect, test } from 'bun:test';
import { history } from '@milkdown/kit/prose/history';
import {
  EditorState,
  type PluginView,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MockLanguageModelV4 } from 'ai/test';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { EditController } from '../src/ai/edit/controller';
import { EditError, replaceText } from '../src/ai/edit/text-edit';
import {
  builtinQuickPrompt,
  quickActionName,
  quickCommands,
} from '../src/ai/quick/actions';
import { askModel } from '../src/ai/quick/ask';
import {
  type Placement,
  landingTarget,
  quickEdit,
} from '../src/ai/quick/place';
import {
  CONTEXT_BEFORE,
  cleanReply,
  continuation,
  quickPrompt,
} from '../src/ai/quick/prompt';
import type { NyaEditor } from '../src/editor/editor';
import { placesPlugin } from '../src/editor/plugins/ai-places';
import { proposalsPlugin } from '../src/editor/plugins/ai-proposals';
import {
  type AiEditMode,
  BUILTIN_QUICK_ACTIONS,
  defaultQuickActions,
  sanitizeAiSettings,
} from '../src/state/ai-settings';
import { env, parse, serialize } from './ai-edit-helpers';

const keys = (key: string) => key;

describe('the AI menu’s commands', () => {
  test('start as the built-in ones, named in the app’s language', () => {
    const commands = quickCommands(defaultQuickActions(), keys, 'en');
    expect(commands.map((command) => command.id)).toEqual([
      ...BUILTIN_QUICK_ACTIONS,
    ]);
    expect(commands[0]).toEqual({
      id: 'polish',
      name: 'ai.quick.action.polish',
      prompt: builtinQuickPrompt('polish', 'en'),
    });
  });

  test('translate into the Chinese the app is written in', () => {
    expect(builtinQuickPrompt('translate-zh', 'zh-TW')).toContain(
      'Traditional'
    );
    expect(builtinQuickPrompt('translate-zh', 'zh-CN')).toContain('Simplified');
    expect(builtinQuickPrompt('translate-zh', 'en')).toContain('Simplified');
  });

  test('take the user’s name and prompt over the built-in ones', () => {
    const commands = quickCommands(
      [
        { id: 'polish', name: 'Tidy', prompt: '' },
        { id: 'shorter', name: '', prompt: 'Halve it.' },
      ],
      keys,
      'en'
    );
    expect(commands).toEqual([
      {
        id: 'polish',
        name: 'Tidy',
        prompt: builtinQuickPrompt('polish', 'en'),
      },
      { id: 'shorter', name: 'ai.quick.action.shorter', prompt: 'Halve it.' },
    ]);
  });

  test('leave out the user’s own until they ask for something', () => {
    const long = 'Turn the text into a table with one row for each item named';
    const commands = quickCommands(
      [
        { id: 'q-empty', name: 'Nothing yet', prompt: '' },
        { id: 'q-long', name: '', prompt: long },
      ],
      keys,
      'en'
    );
    expect(commands).toEqual([
      { id: 'q-long', name: `${long.slice(0, 40)}…`, prompt: long },
    ]);
    expect(
      quickActionName({ id: 'q-empty', name: '', prompt: '' }, keys, 'en')
    ).toBe('');
  });

  test('are kept in the settings as they were, within bounds', () => {
    expect(sanitizeAiSettings({}).quickActions).toEqual(defaultQuickActions());
    expect(sanitizeAiSettings({ quickActions: [] }).quickActions).toEqual([]);
    const actions = sanitizeAiSettings({
      quickActions: [
        { id: 'q-1', name: '  Mine ', prompt: ' Do it. ' },
        { id: 'q-1', name: 'Again', prompt: 'Twice.' },
        { id: 'bad id!', name: 'x', prompt: 'y' },
        { id: 'polish', name: 1, prompt: null },
        'nonsense',
      ],
    }).quickActions;
    expect(actions).toEqual([
      { id: 'q-1', name: 'Mine', prompt: 'Do it.' },
      { id: 'polish', name: '', prompt: '' },
    ]);
    const many = Array.from({ length: 50 }, (_, index) => ({
      id: `q-${index}`,
      name: '',
      prompt: 'p',
    }));
    expect(
      sanitizeAiSettings({ quickActions: many }).quickActions
    ).toHaveLength(40);
  });
});

describe('what a command asks the model', () => {
  const context = {
    title: 'notes.md',
    before: 'Intro.\n\n',
    selected: 'Some text.',
    after: '\n\nOutro.\n',
  };

  test('changes the selection between the text around it', () => {
    const { instructions, prompt } = quickPrompt(
      { kind: 'transform', instruction: ' Make it shorter. ' },
      context,
      'Write in British English.'
    );
    expect(instructions).toContain('passage as changed');
    expect(instructions).toContain('Write in British English.');
    expect(prompt).toContain('"notes.md"');
    expect(prompt).toContain('<before>\nIntro.\n\n\n</before>');
    expect(prompt).toContain('<selection>\nSome text.\n</selection>');
    expect(prompt).toContain('<after>');
    expect(prompt.endsWith('as follows:\nMake it shorter.')).toBe(true);
  });

  test('sums up only what is above the caret', () => {
    const { prompt } = quickPrompt(
      { kind: 'summarize' },
      { ...context, title: null, selected: '' },
      ''
    );
    expect(prompt).toContain('no file name yet');
    expect(prompt).toContain('<before_caret>');
    expect(prompt).not.toContain('<after_caret>');
    expect(prompt).not.toContain('keep this in mind');
  });

  test('carries on with the text on both sides, the start cut first', () => {
    const before = `${'a'.repeat(CONTEXT_BEFORE)}TAIL`;
    const { prompt } = quickPrompt(
      { kind: 'continue' },
      { ...context, before, selected: '' },
      ''
    );
    expect(prompt).toContain('<after_caret>');
    expect(prompt).toContain('TAIL');
    expect(prompt).not.toContain('a'.repeat(CONTEXT_BEFORE));
  });

  test('writes what the user typed at the caret', () => {
    const { prompt } = quickPrompt(
      { kind: 'write', instruction: 'A haiku about cats' },
      { ...context, selected: '' },
      ''
    );
    expect(prompt.endsWith('Write at the caret:\nA haiku about cats')).toBe(
      true
    );
  });
});

const reader = unified().use(remarkParse).use(remarkGfm);
const cleaned = (reply: string) =>
  cleanReply(reply, (markdown) => reader.parse(markdown));

describe('the reply as it goes in', () => {
  test('loses the fence around it', () => {
    expect(cleaned('\n\nHello.  \n')).toBe('Hello.');
    expect(cleaned('```markdown\n# Title\n\nText\n```')).toBe(
      '# Title\n\nText'
    );
    expect(cleaned('~~~\nplain\n~~~\n')).toBe('plain');
    expect(cleaned('````md\nSee:\n\n```sh\nls\n```\n````')).toBe(
      'See:\n\n```sh\nls\n```'
    );
  });

  test('keeps a fence that is only part of it', () => {
    const reply = 'Run this:\n\n```sh\nls\n```';
    expect(cleaned(reply)).toBe(reply);
    expect(cleaned('```js\nlet a;\n```')).toBe('```js\nlet a;\n```');
    const two = '```\na\n```\n\nThen:\n\n```\nb\n```';
    expect(cleaned(two)).toBe(two);
    expect(cleaned('    indented code')).toBe('    indented code');
  });

  test('puts a space between words the model ran together', () => {
    expect(continuation('Hello', 'world')).toBe(' world');
    expect(continuation('It ended.', 'Then')).toBe(' Then');
    expect(continuation('Hello ', 'world')).toBe('world');
    expect(continuation('Hello', ', world')).toBe(', world');
    expect(continuation('(', 'aside')).toBe('aside');
    expect(continuation('', 'Start')).toBe('Start');
  });

  test('puts none in scripts written without spaces', () => {
    expect(continuation('你好', '世界')).toBe('世界');
    expect(continuation('Hello', '世界')).toBe('世界');
    expect(continuation('日本', 'Japan')).toBe('Japan');
    expect(continuation('结束。', 'Next')).toBe('Next');
  });
});

describe('where the reply goes', () => {
  const placement = (over: Partial<Placement> = {}): Placement => ({
    text: 'One two.\n\nThree.\n',
    selection: null,
    caret: 8,
    block: { from: 0, to: 8, empty: false },
    kept: null,
    ...over,
  });

  test('takes the selection, or comes after the caret’s block', () => {
    expect(
      landingTarget(placement({ selection: { from: 4, to: 7 } }), 'replace')
    ).toEqual({ from: 4, to: 7, blocks: false });
    expect(landingTarget(placement(), 'continue')).toEqual({
      from: 8,
      to: 8,
      blocks: false,
    });
    expect(landingTarget(placement(), 'blocks')).toEqual({
      from: 8,
      to: 8,
      blocks: true,
    });
  });

  test('takes the place of the empty line a slash command leaves', () => {
    const empty = placement({ block: { from: 10, to: 16, empty: true } });
    for (const landing of ['continue', 'blocks', 'replace'] as const) {
      expect(landingTarget(empty, landing)).toEqual({
        from: 10,
        to: 16,
        blocks: true,
      });
    }
  });

  /** `reply` put in `text` where `landing` takes it, nothing typed since. */
  const put = (
    over: Partial<Placement>,
    landing: 'replace' | 'continue' | 'blocks',
    reply: string
  ) => {
    const at = placement(over);
    return quickEdit(at, at, landing, reply).next;
  };

  test('replaces the selection with the reply', () => {
    expect(put({ selection: { from: 4, to: 7 } }, 'replace', '2')).toBe(
      'One 2.\n\nThree.\n'
    );
  });

  test('carries on from the caret, spaced as words are', () => {
    const line = {
      text: 'It was late\n',
      caret: 11,
      block: { from: 0, to: 11, empty: false },
    };
    expect(put(line, 'continue', 'and dark.')).toBe('It was late and dark.\n');
  });

  test('goes in as blocks of its own after the caret’s', () => {
    const text = 'First.\n\nLast.\n';
    expect(
      put(
        { text, block: { from: 0, to: 6, empty: false } },
        'blocks',
        '\nMiddle.\n'
      )
    ).toBe('First.\n\nMiddle.\n\nLast.\n');
    expect(
      put({ text, block: { from: 8, to: 13, empty: false } }, 'blocks', 'End.')
    ).toBe('First.\n\nLast.\n\nEnd.\n\n');
    expect(
      put(
        { text: 'Lone', block: { from: 0, to: 4, empty: false } },
        'blocks',
        'Next.'
      )
    ).toBe('Lone\n\nNext.');
  });

  test('takes an empty line’s place', () => {
    const text = 'Above.\n\n<br />\n\nBelow.\n';
    const from = text.indexOf('<br />');
    const block = { from, to: from + 6, empty: true };
    expect(put({ text, block }, 'blocks', 'Written.')).toBe(
      'Above.\n\nWritten.\n\nBelow.\n'
    );
  });

  test('says when it cannot go in, or changes nothing', () => {
    const caught = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof EditError ? error.code : 'other';
      }
      return null;
    };
    const before = placement({
      text: 'Same.\n',
      selection: { from: 0, to: 5 },
    });
    expect(caught(() => quickEdit(before, before, 'replace', 'Same.'))).toBe(
      'no_change'
    );
    const now = placement({ text: 'Other.\n', selection: { from: 0, to: 6 } });
    expect(caught(() => quickEdit(before, now, 'replace', 'New.'))).toBe(
      'not_found'
    );
  });
});

const controllers: EditController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
});

/** A controller on an editor that is no more than its state. */
function setup(text: string, mode: AiEditMode = 'review') {
  let pluginViews: PluginView[] = [];
  const view = {
    state: EditorState.create({
      doc: parse(text),
      plugins: [history(), proposalsPlugin(), placesPlugin()],
    }),
    composing: false,
    isDestroyed: false,
    dom: new EventTarget(),
    dispatch(tr: Transaction) {
      const previous = view.state;
      view.state = view.state.apply(tr);
      for (const each of pluginViews) each.update?.(asView, previous);
    },
  };
  const asView = view as unknown as EditorView;
  pluginViews = view.state.plugins.flatMap((plugin) =>
    plugin.spec.view ? [plugin.spec.view(asView)] : []
  );
  const editor = {
    whenReady: async () => undefined,
    getView: () => asView,
    getMarkdown: () => serialize(view.state.doc),
    serializeDoc: serialize,
    parseMarkdown: parse,
    blockSpans: env.blockSpans,
  } as unknown as NyaEditor;
  const controller = new EditController({
    editor,
    sourceSelection: () => null,
    flushSource: () => undefined,
    localImage: async () => null,
    followSource: () => undefined,
    editMode: () => mode,
  });
  controllers.push(controller);
  const select = (from: number, to = from) =>
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))
    );
  return { view, controller, select, text: () => serialize(view.state.doc) };
}

describe('the selection and the caret in the Markdown', () => {
  const TEXT = 'one **two** three\n\nsecond paragraph\n';

  test('cover what is selected, with the markup around it', async () => {
    const { controller, select } = setup(TEXT);
    // "two", inside the bold.
    select(5, 8);
    const placement = await controller.placement();
    expect(placement.text).toBe(TEXT);
    const { from, to } = placement.selection ?? { from: 0, to: 0 };
    expect(['two', '**two**']).toContain(TEXT.slice(from, to));
  });

  test('widen to whole blocks when the selection cuts through markup', async () => {
    const { controller, select } = setup(TEXT);
    // "ne tw": into the bold from outside it.
    select(2, 7);
    const placement = await controller.placement();
    expect(placement.selection).toEqual({ from: 0, to: 17 });
  });

  test('put the caret and its block where they are', async () => {
    const { controller, select } = setup(TEXT);
    select(13);
    const placement = await controller.placement();
    expect(placement.selection).toBeNull();
    expect(TEXT.slice(0, placement.caret)).toBe('one **two** thre');
    expect(placement.block).toEqual({ from: 0, to: 17, empty: false });
  });

  test('read the proposals waiting in the text', async () => {
    const { controller, select } = setup(TEXT);
    await controller.edit((text) => replaceText(text, 'second', 'SECOND'));
    select(1);
    const placement = await controller.placement();
    expect(placement.text).toBe('one **two** three\n\nSECOND paragraph\n');
  });
});

describe('an edit of the AI menu', () => {
  const TEXT = 'one two three\n\nsecond paragraph\n';

  test('is proposed like the assistant’s and kept from its conversation', async () => {
    const { controller, text } = setup(TEXT);
    await controller.read();
    const { report, notices } = await controller.edit(
      (current) => replaceText(current, 'two', 'TWO'),
      false
    );
    expect(notices).toBeNull();
    expect(report.status).toBe('proposed');
    expect(text()).toBe(TEXT);
    controller.acceptEdit(report.edit);
    expect(text()).toBe('one TWO three\n\nsecond paragraph\n');
    // The assistant hears of the change as of one the user made.
    const told = await controller.notices();
    expect(told).not.toContain(`edit ${report.edit}`);
    expect(told).toContain('The text differs from how you last saw it');
  });

  test('lands where the command ran, the user having written on', async () => {
    const { view, controller, select, text } = setup(TEXT, 'auto');
    // "two".
    select(5, 8);
    const placement = await controller.placement();
    view.dispatch(view.state.tr.insertText('Zero, ', 1));
    view.dispatch(
      view.state.tr.insertText('more ', view.state.doc.content.size - 10)
    );
    const { report } = await controller.placeReply(placement, 'replace', 'TWO');
    expect(report.status).toBe('applied');
    expect(text()).toBe('Zero, one TWO three\n\nsecond more paragraph\n');
  });

  test('carries on after what the user typed at the caret', async () => {
    const { view, controller, select, text } = setup(TEXT, 'auto');
    // After "three".
    select(14);
    const placement = await controller.placement();
    view.dispatch(view.state.tr.insertText(' and', 14));
    await controller.placeReply(placement, 'continue', 'four.');
    expect(text()).toBe('one two three and four.\n\nsecond paragraph\n');
  });

  test('is not put in where the user changed or deleted the text', async () => {
    const { view, controller, select, text } = setup(TEXT, 'auto');
    select(5, 8);
    const changed = await controller.placement();
    view.dispatch(view.state.tr.insertText('X', 6));
    await expect(
      controller.placeReply(changed, 'replace', 'TWO')
    ).rejects.toMatchObject({ code: 'not_found' });
    select(14);
    const deleted = await controller.placement();
    view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize));
    await expect(
      controller.placeReply(deleted, 'continue', 'four.')
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(text()).toBe('second paragraph\n');
  });

  test('lets the place go when the menu is done with it', async () => {
    const { controller, select } = setup(TEXT, 'auto');
    select(5, 8);
    const placement = await controller.placement();
    controller.forget(placement);
    await expect(
      controller.placeReply(placement, 'replace', 'TWO')
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  test('goes in at once in automatic mode', async () => {
    const { controller, text } = setup(TEXT, 'auto');
    const { report } = await controller.edit(
      (current) => replaceText(current, 'three', '3'),
      false
    );
    expect(report.status).toBe('applied');
    expect(text()).toBe('one two 3\n\nsecond paragraph\n');
  });
});

describe('asking the model', () => {
  type StreamPart = Awaited<
    ReturnType<MockLanguageModelV4['doStream']>
  >['stream'] extends ReadableStream<infer Part>
    ? Part
    : never;

  const finish: StreamPart = {
    type: 'finish',
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    finishReason: { unified: 'stop', raw: 'stop' },
  };

  const modelOf = (parts: StreamPart[]) =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }),
    });

  test('streams the reply and gives it whole', async () => {
    const model = modelOf([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Hel' },
      { type: 'text-delta', id: 't', delta: 'lo.' },
      { type: 'text-end', id: 't' },
      finish,
    ]);
    const seen: string[] = [];
    const reply = await askModel(
      model,
      { instructions: 'Be brief.', prompt: 'Say hello.' },
      (text) => seen.push(text),
      new AbortController().signal
    );
    expect(reply).toBe('Hello.');
    expect(seen).toEqual(['Hel', 'Hello.']);
    const call = model.doStreamCalls[0];
    expect(JSON.stringify(call.prompt)).toContain('Be brief.');
    expect(JSON.stringify(call.prompt)).toContain('Say hello.');
    expect(call.tools ?? []).toEqual([]);
  });

  test('throws what went wrong', async () => {
    const model = modelOf([
      { type: 'error', error: new Error('upstream exploded') },
    ]);
    await expect(
      askModel(
        model,
        { instructions: '', prompt: 'x' },
        () => undefined,
        new AbortController().signal
      )
    ).rejects.toThrow('upstream exploded');
  });

  test('stops when asked', async () => {
    const stop = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Half' });
            abortSignal?.addEventListener('abort', () =>
              controller.error(abortSignal.reason)
            );
          },
        }),
      }),
    });
    const asked = askModel(
      model,
      { instructions: '', prompt: 'x' },
      () => stop.abort(),
      stop.signal
    );
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
  });
});
