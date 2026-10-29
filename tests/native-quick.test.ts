import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Placement } from '../src/ai/quick/place';
import { i18next } from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import {
  type AiProvider,
  BUILTIN_QUICK_ACTIONS,
  defaultAiSettings,
} from '../src/state/ai-settings';

type Request = { instructions: string; prompt: string };

const posted: Array<Record<string, unknown>> = [];
const settingsOpened: Array<[string, unknown]> = [];
const asked: Request[] = [];
let answer: (request: Request) => Promise<string> = async () => 'Reply';
let current = {} as import('../src/state/settings').Settings;

mock.module('../src/ai/mcp/hub', () => ({ mcpHub: () => ({}) }));
mock.module('../src/ai/quick/quick.css?inline', () => ({ default: '' }));
mock.module('../src/style/register', () => ({ ensureStyle: () => undefined }));
mock.module('../src/ai/providers/connect', () => ({
  connectModel: () => ({ id: 'model' }),
}));
mock.module('../src/ai/quick/ask', () => ({
  askModel: (
    _model: unknown,
    request: Request,
    onText: (text: string) => void
  ) => {
    asked.push(request);
    onText('Partial');
    return answer(request);
  },
}));
mock.module('../src/features/native/markdown-blocks', () => ({
  markdownBlocks: (text: string) => [
    { kind: 'paragraph', inlines: [{ text }] },
  ],
}));
mock.module('../src/features/native/settings', () => ({
  openNativeSettings: (tab: string, options: unknown) => {
    settingsOpened.push([tab, options]);
  },
}));

const settings = await import('../src/state/settings');
current = settings.getSettings();
mock.module('../src/state/settings', () => ({
  ...settings,
  getSettings: () => current,
  subscribeSettings: (listener: (value: typeof current) => void) => {
    listener(current);
    return () => undefined;
  },
  updateSettings: async () => undefined,
}));

const realPanel = await import('../src/features/native/ai-panel');
type AiCore = import('../src/features/native/ai-panel').AiCore;

const edits = {
  placed: [] as Array<[Placement, string, string]>,
  revealed: [] as string[],
  forgotten: 0,
  placement: null as Placement | null,
  failing: false,
};
const emptyEdits = () => {
  edits.placed = [];
  edits.revealed = [];
  edits.forgotten = 0;
  edits.failing = false;
};

const stubCore = (): AiCore => ({
  session: {
    entries: [],
    busy: false,
    send: async () => undefined,
    stop: () => undefined,
    retry: async () => undefined,
    subscribe: () => () => undefined,
  } as unknown as AiCore['session'],
  edits: {
    subscribe: () => () => undefined,
    pending: () => [],
    position: () => 0,
    outcome: () => null,
    acceptEdit: () => undefined,
    rejectEdit: () => undefined,
    revealEdit: (edit?: string) => {
      if (edit) edits.revealed.push(edit);
    },
    step: () => undefined,
    accept: () => undefined,
    reject: () => undefined,
    placement: async () => edits.placement as Placement,
    forget: () => {
      edits.forgotten++;
    },
    placeReply: async (placement, landing, reply) => {
      if (edits.failing) throw new Error('The text changed.');
      edits.placed.push([placement, landing, reply]);
      return {
        report: { status: 'proposed', edit: 'e1', changes: 1 },
        notices: null,
      } as never;
    },
  },
  keeper: {
    current: 'c1',
    list: async () => [],
    open: async () => true,
    remove: async () => undefined,
    startNew: () => undefined,
    flush: () => undefined,
  },
  approvals: {
    request: () => null,
    answer: () => undefined,
    subscribe: () => () => undefined,
  },
});

mock.module('../src/features/native/ai-panel', () => ({
  ...realPanel,
  NativeAiPanel: class extends realPanel.NativeAiPanel {
    constructor(
      host: ConstructorParameters<typeof realPanel.NativeAiPanel>[0]
    ) {
      super(host, stubCore(), { thumbnail: async () => '' });
    }
  },
}));

const { askNativeAi, bindNativeAi } = await import('../src/features/native/ai');
const { dispatchPanel } = await import('../src/features/native/panels');
const { menuItems, quickRequest } = await import('../src/ai/quick/core');
const { builtinQuickPrompt } = await import('../src/ai/quick/actions');
const { quickStateData } = await import('../src/features/native/quick');

await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

class FakeElement {}
Object.assign(globalThis, {
  HTMLElement: FakeElement,
  document: {
    activeElement: null,
    documentElement: {
      classList: { add: () => undefined, remove: () => undefined },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
  window: {
    webkit: {
      messageHandlers: {
        nyamark: {
          postMessage: (message: Record<string, unknown>) => {
            posted.push(message);
          },
        },
      },
    },
    getSelection: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const provider = (): AiProvider => ({
  id: 'p1',
  name: 'Provider',
  preset: 'custom',
  kind: 'openai',
  auth: 'key',
  baseUrl: 'https://example.com/v1',
  models: [
    {
      id: 'm1',
      vision: false,
      tools: true,
      reasoning: false,
      contextWindow: 1000,
    },
  ],
});

const withModel = (patch: Partial<typeof defaultAiSettings> = {}) => {
  current = {
    ...current,
    ai: {
      ...defaultAiSettings,
      providers: [provider()],
      chatModel: { provider: 'p1', model: 'm1' },
      ...patch,
    },
  };
};

const SELECTED: Placement = {
  text: 'Hello world',
  selection: { from: 0, to: 5 },
  caret: 5,
  block: { from: 0, to: 11, empty: false },
  kept: 1,
};
const AT_CARET: Placement = {
  text: 'Hello world',
  selection: null,
  caret: 11,
  block: { from: 0, to: 11, empty: false },
  kept: 2,
};

const editor = {
  markdownTree: () => ({ type: 'root', children: [] }),
} as never;

const message = (
  panel: string,
  op: string,
  data: Record<string, unknown> = {}
) => ({
  type: 'panel',
  panel,
  op,
  ...data,
});
const toQuick = (op: string, data: Record<string, unknown> = {}) =>
  dispatchPanel(message('quick', op, data));
const quickSent = (op: string) =>
  posted.filter((entry) => entry.panel === 'quick' && entry.op === op);
const lastState = () =>
  quickSent('state').at(-1) as unknown as ReturnType<typeof quickStateData>;

async function until(done: () => boolean) {
  for (let tries = 0; tries < 200 && !done(); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(done()).toBe(true);
}

/** Has the sheet report it is gone, as the phone does. */
const sheetGone = () => toQuick('close');

bindNativeAi({ editor: () => editor, sourceMode: () => null });

beforeEach(async () => {
  await sheetGone();
  posted.length = 0;
  asked.length = 0;
  settingsOpened.length = 0;
  emptyEdits();
  answer = async () => 'Reply';
  edits.placement = SELECTED;
  withModel();
});

describe('askNativeAi', () => {
  test('the menu lists the built-in commands over a selection, then the conversation', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    expect(quickSent('present')).toHaveLength(1);
    const state = lastState();
    expect(state.view).toBe('menu');
    expect(state.placeholder).toBe(i18next.t('ai.quick.placeholderSelection'));
    expect(state.items.map((item) => item.label)).toEqual([
      ...BUILTIN_QUICK_ACTIONS.map((id) => i18next.t(`ai.quick.action.${id}`)),
      i18next.t('ai.quick.toChat'),
    ]);
    expect(state.items.map((item) => item.id)).toEqual([
      ...BUILTIN_QUICK_ACTIONS.map((id) => `command:${id}`),
      'chat',
    ]);
    expect(asked).toEqual([]);
  });

  test('the user’s own commands join the list, and one with no prompt is left out', async () => {
    withModel({
      quickActions: [
        { id: 'polish', name: '', prompt: '' },
        { id: 'mine', name: 'Mine', prompt: 'Do mine' },
        { id: 'empty', name: 'Nothing', prompt: '' },
      ],
    });
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    expect(lastState().items.map((item) => item.label)).toEqual([
      i18next.t('ai.quick.action.polish'),
      'Mine',
      i18next.t('ai.quick.toChat'),
    ]);
  });

  test('at a caret the menu offers to continue and to summarize', async () => {
    edits.placement = AT_CARET;
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    const state = lastState();
    expect(state.placeholder).toBe(i18next.t('ai.quick.placeholderCaret'));
    expect(state.items.map((item) => item.label)).toEqual([
      i18next.t('ai.quick.continue'),
      i18next.t('ai.quick.summarize'),
      i18next.t('ai.quick.toChat'),
    ]);
  });

  test('what is typed filters the commands and comes first', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    await toQuick('prompt', { text: 'translate' });
    expect(lastState().items.map((item) => item.label)).toEqual([
      i18next.t('ai.quick.changeAs', { text: 'translate' }),
      i18next.t('ai.quick.action.translate-en'),
      i18next.t('ai.quick.action.translate-zh'),
      i18next.t('ai.quick.toChat'),
    ]);
  });

  test('running a command asks the model what the popover asks, and proposes the reply', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    await toQuick('run', { id: 'command:polish' });
    await until(() => edits.placed.length > 0);

    const run = menuItems('', true, current.ai.quickActions).find(
      (item) => item.id === 'command:polish'
    )?.run;
    if (!run) throw new Error('Expected a command');
    expect(asked).toEqual([quickRequest(run, SELECTED, null, '')]);
    expect(asked[0]?.prompt).toContain(builtinQuickPrompt('polish', 'en'));
    expect(asked[0]?.prompt).toContain('<selection>\nHello\n</selection>');

    expect(edits.placed).toEqual([[SELECTED, 'replace', 'Reply']]);
    expect(edits.revealed).toEqual(['e1']);
    expect(quickSent('hide')).toHaveLength(1);
    const running = quickSent('state').find(
      (state) => state.view === 'running'
    );
    expect(running?.label).toBe(i18next.t('ai.quick.action.polish'));
    expect(running?.buttons).toEqual([
      { id: 'stop', label: i18next.t('ai.stop') },
    ]);
  });

  test('a typed instruction changes the selection as asked', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    await toQuick('prompt', { text: 'make it fun' });
    await toQuick('run', { id: 'typed' });
    await until(() => asked.length > 0);
    expect(asked[0]?.prompt).toContain('make it fun');
    expect(asked[0]?.prompt).toContain('<selection>\nHello\n</selection>');
  });

  test('continue runs at once, without showing the list', async () => {
    edits.placement = AT_CARET;
    let finish: (reply: string) => void = () => undefined;
    answer = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    askNativeAi('continue');
    await until(() => asked.length > 0);
    await until(() => quickSent('state').length > 0);
    expect(quickSent('state').map((state) => state.view)).not.toContain('menu');
    expect(lastState().view).toBe('running');
    expect(lastState().label).toBe(i18next.t('ai.quick.continue'));
    expect(asked[0]?.prompt).toContain(
      'Continue from the end of <before_caret>.'
    );

    finish(' and on.');
    await until(() => edits.placed.length > 0);
    expect(edits.placed[0]?.[1]).toBe('continue');
  });

  test('the reply shows as it comes', async () => {
    let finish: (reply: string) => void = () => undefined;
    answer = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    askNativeAi('summarize');
    await until(() => asked.length > 0);
    await until(() => lastState()?.preview != null);
    expect(lastState().preview).toEqual([
      { kind: 'paragraph', inlines: [{ text: 'Partial' }] },
    ]);
    expect(lastState().hint).toBe(i18next.t('ai.quick.escHint'));
    finish('Summary');
    await until(() => edits.placed.length > 0);
    expect(edits.placed[0]?.[1]).toBe('blocks');
  });

  test('stop ends the request and closes the sheet', async () => {
    answer = () => new Promise(() => undefined);
    askNativeAi('continue');
    await until(() => asked.length > 0);
    await toQuick('stop');
    expect(quickSent('hide')).toHaveLength(1);
    expect(edits.forgotten).toBeGreaterThan(0);
  });

  test('a failure offers retry, and retrying asks again', async () => {
    answer = async () => {
      throw new Error('Boom');
    };
    askNativeAi('continue');
    await until(() => lastState()?.view === 'problem');
    const state = lastState();
    expect(state.note).toBe(i18next.t('ai.error.other'));
    expect(state.detail).toBe('Boom');
    expect(state.buttons.map((button) => button.id)).toEqual([
      'retry',
      'close',
    ]);

    await toQuick('retry');
    await until(() => asked.length === 2);
  });

  test('a reply the document cannot take is kept to copy', async () => {
    edits.failing = true;
    askNativeAi('continue');
    await until(() => lastState()?.view === 'problem');
    expect(lastState().note).toBe(i18next.t('ai.quick.notPlaced'));
    expect(lastState().buttons.map((button) => button.id)).toEqual([
      'copy',
      'close',
    ]);
    await toQuick('copy');
    expect(quickSent('copy')).toEqual([
      { type: 'panel', panel: 'quick', op: 'copy', text: 'Reply' },
    ]);
  });

  test('with no model it asks to set one up, and the settings open once the sheet has gone', async () => {
    current = { ...current, ai: { ...defaultAiSettings } };
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    const state = lastState();
    expect(state.view).toBe('noModel');
    expect(state.note).toBe(i18next.t('ai.error.noModel'));
    expect(state.buttons).toEqual([
      { id: 'settings', label: i18next.t('ai.openSettings'), primary: true },
    ]);
    expect(asked).toEqual([]);

    await toQuick('settings');
    expect(quickSent('hide')).toHaveLength(1);
    expect(settingsOpened).toEqual([]);
    await sheetGone();
    expect(settingsOpened).toEqual([['ai', { addService: undefined }]]);
  });

  test('continuing in the conversation hands it the text typed', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    await toQuick('prompt', { text: 'explain this' });
    await toQuick('run', { id: 'chat' });
    expect(quickSent('hide')).toHaveLength(1);
    expect(posted.filter((entry) => entry.panel === 'ai')).toEqual([]);

    await sheetGone();
    await until(() =>
      posted.some((entry) => entry.panel === 'ai' && entry.op === 'present')
    );
    await dispatchPanel(message('ai', 'open'));
    await until(() =>
      posted.some((entry) => entry.panel === 'ai' && entry.op === 'write')
    );
    expect(posted.find((entry) => entry.op === 'write')).toEqual({
      type: 'panel',
      panel: 'ai',
      op: 'write',
      text: 'explain this',
    });
    await dispatchPanel(message('ai', 'close'));
  });

  test('asking again while the sheet is up uses it again', async () => {
    askNativeAi('menu');
    await until(() => quickSent('state').length > 0);
    askNativeAi('menu');
    await until(() => quickSent('state').length > 1);
    expect(quickSent('present')).toHaveLength(1);
  });
});

describe('quickStateData', () => {
  test('a failure with a fix in the settings leads with it', () => {
    const state = quickStateData({
      view: {
        kind: 'problem',
        run: {
          task: { kind: 'continue' },
          landing: 'continue',
          label: 'Continue writing',
        },
        message: 'No key',
        detail: null,
        reply: null,
        fix: 'settings',
      },
      session: 1,
      typed: '',
      selected: false,
      preview: null,
    });
    expect(state.buttons.map((button) => button.id)).toEqual([
      'settings',
      'retry',
      'close',
    ]);
    expect(state.buttons[0]?.primary).toBe(true);
  });
});
