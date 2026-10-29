import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  AssistantEntry,
  ChatEntry,
  ChatSession,
  SessionChange,
  ToolPart,
  UserEntry,
} from '../src/ai/agent/session';
import type { ChatImage } from '../src/ai/images/image';
import { i18next } from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import {
  type AiProvider,
  type AiSettings,
  defaultAiSettings,
  modelLabel,
} from '../src/state/ai-settings';

mock.module('../src/ai/mcp/hub', () => ({ mcpHub: () => ({}) }));
mock.module('../src/features/native/markdown-blocks', () => ({
  markdownBlocks: (text: string) => [
    { kind: 'paragraph', inlines: [{ text }] },
  ],
}));
mock.module('../src/ai/images/prepare', () => ({
  prepareImage: async (_source: Blob, name: string): Promise<ChatImage> => ({
    name,
    mediaType: 'image/png',
    data: new Uint8Array([1, 2, 3]),
    width: 4,
    height: 3,
  }),
}));

const { modelChoices } = await import('../src/ai/ui/model-picker');
const { toolLabel } = await import('../src/ai/ui/tool-labels');
const { NativeAiPanel, entryData, stateData } = await import(
  '../src/features/native/ai-panel'
);
type AiCore = import('../src/features/native/ai-panel').AiCore;
type EntryContext = import('../src/features/native/ai-panel').EntryContext;
type AssistantEntryData = import(
  '../src/features/native/ai-panel'
).AssistantEntryData;

await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

const posted: Array<Record<string, unknown>> = [];
const settingsListeners = new Set<(event: unknown) => void>();
Object.assign(globalThis, {
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
    addEventListener: (_type: string, listener: (event: unknown) => void) => {
      settingsListeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: unknown) => void
    ) => {
      settingsListeners.delete(listener);
    },
  },
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});

/** Has the panels hear that the settings changed to `ai`. */
const changeSettings = (ai: AiSettings) => {
  for (const listener of settingsListeners) listener({ detail: { ai } });
};

const frame = () => new Promise((resolve) => setTimeout(resolve, 5));
const sent = (op: string) => posted.filter((message) => message.op === op);

const context = (patch: Partial<EntryContext> = {}): EntryContext => ({
  outcome: () => null,
  request: () => null,
  documentName: () => 'draft.md',
  thumbnail: () => 'thumb',
  blocks: (_key, text) => [{ kind: 'paragraph', inlines: [{ text }] }],
  ...patch,
});

const tool = (patch: Partial<ToolPart> = {}): ToolPart => ({
  type: 'tool',
  id: 't1',
  name: 'read_document',
  input: {},
  state: 'running',
  ...patch,
});

const reply = (patch: Partial<AssistantEntry> = {}): AssistantEntry => ({
  id: 2,
  role: 'assistant',
  parts: [],
  status: 'streaming',
  model: 'Model',
  historyStart: 0,
  ...patch,
});

const asked = (text: string, images: ChatImage[] = []): UserEntry => ({
  id: 1,
  role: 'user',
  text,
  images,
});

const image = (name = 'a.png'): ChatImage => ({
  name,
  mediaType: 'image/png',
  data: new Uint8Array([9, 9]),
  width: 4,
  height: 3,
});

const provider = (patch: Partial<AiProvider> = {}): AiProvider => ({
  id: 'p1',
  name: 'Provider',
  preset: 'custom',
  kind: 'openai',
  auth: 'key',
  baseUrl: 'https://example.com/v1',
  models: [
    {
      id: 'm1',
      name: 'Model One',
      vision: true,
      tools: true,
      reasoning: false,
      contextWindow: 1000,
    },
    {
      id: 'm2',
      vision: false,
      tools: true,
      reasoning: false,
      contextWindow: 1000,
    },
  ],
  ...patch,
});

const withModels = (patch: Partial<AiSettings> = {}): AiSettings => ({
  ...defaultAiSettings,
  providers: [provider()],
  chatModel: { provider: 'p1', model: 'm2' },
  ...patch,
});

const stateOf = (ai: AiSettings, entries: ChatEntry[] = []) =>
  stateData({
    ai,
    entries,
    busy: false,
    pending: 0,
    position: 0,
    tray: [],
    note: null,
    thumbnail: () => '',
  });

describe('entryData', () => {
  test('an assistant entry with text and a running tool is a text part and a fold', () => {
    const running = tool();
    const data = entryData(
      reply({ parts: [{ type: 'text', text: 'Hello' }, running] }),
      context()
    ) as AssistantEntryData;
    expect(data.parts).toHaveLength(2);
    expect(data.parts[0]).toEqual({
      kind: 'text',
      blocks: [{ kind: 'paragraph', inlines: [{ text: 'Hello' }] }],
    });
    const group = data.parts[1];
    if (group?.kind !== 'group') throw new Error('Expected a fold');
    expect(group.state).toBe('live');
    expect(group.label).toBe(toolLabel(running));
    expect(group.parts).toEqual([
      {
        kind: 'tool',
        id: 't1',
        label: toolLabel(running),
        state: 'running',
      },
    ]);
    expect(data.waiting).toBe(false);
    expect(data.foot).toBeNull();
  });

  test('steps between two runs of text fold together', () => {
    const data = entryData(
      reply({
        status: 'done',
        parts: [
          { type: 'reasoning', text: 'Thinking' },
          tool({ id: 'a', state: 'done' }),
          tool({ id: 'b', state: 'done' }),
          { type: 'text', text: 'Done' },
          tool({ id: 'c', state: 'done' }),
        ],
      }),
      context()
    ) as AssistantEntryData;
    expect(data.parts.map((part) => part.kind)).toEqual([
      'group',
      'text',
      'group',
    ]);
    const first = data.parts[0];
    if (first?.kind !== 'group') throw new Error('Expected a fold');
    expect(first.parts.map((part) => part.kind)).toEqual([
      'reasoning',
      'tool',
      'tool',
    ]);
    expect(first.label).toBe(i18next.t('ai.steps.done', { count: 2 }));
    expect(first.single).toBe(false);
    const last = data.parts[2];
    if (last?.kind !== 'group') throw new Error('Expected a fold');
    expect(last.single).toBe(true);
    expect(last.flat).toBe(true);
  });

  test('a reply waits for the first word until it has one', () => {
    const data = entryData(reply(), context()) as AssistantEntryData;
    expect(data.waiting).toBe(true);
    expect(data.parts).toEqual([]);
  });

  test('a finished reply has a foot with copy; a stopped one can retry', () => {
    const done = entryData(
      reply({
        status: 'done',
        parts: [{ type: 'text', text: 'Hi' }],
        usage: { input: 1200, output: 30 },
      }),
      context()
    ) as AssistantEntryData;
    expect(done.foot?.actions.map((action) => action.id)).toEqual(['copy']);
    expect(done.foot?.text).toContain('Model');
    expect(done.foot?.text).toContain(
      i18next.t('ai.usage', { input: '1.2K', output: '30' })
    );
    const stopped = entryData(
      reply({ status: 'stopped', parts: [{ type: 'text', text: 'Hi' }] }),
      context()
    ) as AssistantEntryData;
    expect(stopped.status?.text).toBe(i18next.t('ai.stopped'));
    expect(stopped.foot?.actions.map((action) => action.id)).toEqual([
      'copy',
      'retry',
    ]);
  });

  test('a failure offers the settings where they fix it, and retry', () => {
    const data = entryData(
      reply({
        status: 'error',
        error: { code: 'key-needed', message: 'Missing key' },
      }),
      context()
    ) as AssistantEntryData;
    expect(data.error?.text).toBe(i18next.t('ai.error.keyNeeded'));
    expect(data.error?.detail).toBeNull();
    expect(data.error?.actions.map((action) => action.id)).toEqual([
      'settings',
      'retry',
    ]);
  });

  test('a user entry carries its text and thumbnails', () => {
    const data = entryData(asked('Look', [image()]), context());
    expect(data).toEqual({
      id: 1,
      role: 'user',
      text: 'Look',
      images: [{ thumbnail: 'thumb' }],
    });
  });

  test('a proposed edit raises a card with its outcome', () => {
    const outcome = {
      total: 2,
      accepted: 0,
      rejected: 0,
      dropped: 0,
      replaced: 0,
      pending: 2,
    };
    const data = entryData(
      reply({
        status: 'done',
        parts: [
          tool({
            name: 'edit_document',
            state: 'done',
            output: { status: 'proposed', changes: 2, edit: 'e1' },
          }),
        ],
      }),
      context({ outcome: () => outcome })
    ) as AssistantEntryData;
    const group = data.parts[0];
    if (group?.kind !== 'group') throw new Error('Expected a fold');
    expect(group.cards).toEqual([
      {
        kind: 'edit',
        edit: 'e1',
        title: 'draft.md',
        meta: i18next.t('ai.edit.pending', { count: 2 }),
        pending: true,
        reveal: i18next.t('ai.edit.show'),
        accept: i18next.t('ai.edit.accept'),
        reject: i18next.t('ai.edit.reject'),
      },
    ]);
  });

  test('a tool waiting on the user raises a question with its answers', () => {
    const data = entryData(
      reply({ parts: [tool({ name: 'fetch_url' })] }),
      context({
        request: (id) =>
          id === 't1'
            ? { kind: 'page', url: 'http://192.168.1.1/', host: '192.168.1.1' }
            : null,
      })
    ) as AssistantEntryData;
    const group = data.parts[0];
    if (group?.kind !== 'group') throw new Error('Expected a fold');
    const card = group.cards[0];
    if (card?.kind !== 'approval') throw new Error('Expected a question');
    expect(card.id).toBe('t1');
    expect(card.text).toBe('http://192.168.1.1/');
    expect(card.answers.map((answer) => answer.id)).toEqual(['deny', 'allow']);
    expect(card.answers[1]?.role).toBe('primary');
  });
});

describe('stateData', () => {
  test('with no services it shows the setup card and no composer', () => {
    const state = stateOf(defaultAiSettings);
    expect(state.ready).toBe(false);
    expect(state.empty).toBe(true);
    expect(state.composer).toBeNull();
    expect(state.intro).toBeNull();
    expect(state.setup?.title).toBe(i18next.t('ai.setup.title'));
    expect(state.setup?.services.length).toBeGreaterThan(0);
    expect(
      state.setup?.services.some((service) => service.id === 'custom')
    ).toBe(false);
    expect(state.title).toBe(i18next.t('ai.title'));
  });

  test('with a model and no messages it shows the empty card and the composer', () => {
    const state = stateOf(withModels());
    expect(state.setup).toBeNull();
    expect(state.intro?.suggestions).toHaveLength(4);
    expect(state.intro?.suggestions[0]?.label).toBe(
      i18next.t('ai.empty.summarize')
    );
    expect(state.composer?.placeholder).toBe(i18next.t('ai.placeholder'));
    expect(state.composer?.room).toBe(10);
  });

  test('the model menu lists what the picker lists, the chosen one marked', () => {
    const ai = withModels({
      providers: [
        provider(),
        provider({ id: 'p2', name: 'Empty', models: [] }),
        provider({
          id: 'p3',
          name: 'Other',
          models: [
            {
              id: 'x',
              vision: false,
              tools: true,
              reasoning: false,
              contextWindow: 1,
            },
          ],
        }),
      ],
    });
    const state = stateOf(ai);
    const expected = ai.providers
      .filter((service) => service.models.length > 0)
      .map((service) => ({
        name: service.name,
        labels: service.models.map(modelLabel),
        checked: service.models.map(
          (model) =>
            ai.chatModel?.provider === service.id &&
            ai.chatModel.model === model.id
        ),
      }));
    expect(
      state.model.groups.map((group) => ({
        name: group.name,
        labels: group.options.map((option) => option.label),
        checked: group.options.map((option) => option.checked),
      }))
    ).toEqual(expected);
    expect(state.model.label).toBe(modelChoices(ai).label);
    expect(state.model.label).toBe('m2');
  });

  test('a model that cannot see images warns once an image is attached', () => {
    const ai = withModels();
    const warn = stateData({
      ai,
      entries: [],
      busy: false,
      pending: 0,
      position: 0,
      tray: [{ id: 1, image: image() }],
      note: null,
      thumbnail: () => 't',
    });
    expect(warn.composer?.notice).toBe(
      i18next.t('ai.image.noVision', { model: 'm2' })
    );
    expect(warn.composer?.images).toEqual([
      {
        id: 1,
        name: 'a.png',
        thumbnail: 't',
        remove: i18next.t('ai.image.remove', { name: 'a.png' }),
      },
    ]);
    expect(warn.composer?.room).toBe(9);
  });

  test('the review bar shows while changes wait', () => {
    const state = stateData({
      ai: withModels(),
      entries: [],
      busy: true,
      pending: 3,
      position: 2,
      tray: [],
      note: null,
      thumbnail: () => '',
    });
    expect(state.busy).toBe(true);
    expect(state.review?.text).toBe(
      i18next.t('ai.edit.pendingAt', { count: 3, at: 2 })
    );
    expect(stateOf(withModels()).review).toBeNull();
  });

  test('the effort menu shows only for a model that reasons', () => {
    expect(stateOf(withModels()).effort).toBeNull();
    const reasoning = provider({
      models: [
        {
          id: 'r',
          vision: false,
          tools: true,
          reasoning: true,
          contextWindow: 1,
          efforts: ['low', 'high'],
          effort: 'high',
        },
      ],
    });
    const state = stateOf(
      withModels({
        providers: [reasoning],
        chatModel: { provider: 'p1', model: 'r' },
      })
    );
    expect(state.effort?.options.map((option) => option.value)).toEqual([
      '',
      'low',
      'high',
    ]);
    expect(state.effort?.options.map((option) => option.checked)).toEqual([
      false,
      false,
      true,
    ]);
  });

  test('the conversation is titled by what was first asked', () => {
    const state = stateOf(withModels(), [asked('Summarize the notes')]);
    expect(state.title).toBe('Summarize the notes');
    expect(state.empty).toBe(false);
    expect(state.intro).toBeNull();
  });
});

describe('NativeAiPanel', () => {
  const quiet = { thumbnail: async () => 'thumb' };

  type Stub = {
    core: AiCore;
    emit: (change: SessionChange) => void;
    sends: Array<[string, readonly ChatImage[]]>;
    entries: ChatEntry[];
    started: { stop: number; startNew: number; steps: number[] };
  };

  function stub(entries: ChatEntry[] = []): Stub {
    const listeners = new Set<(change: SessionChange) => void>();
    const sends: Stub['sends'] = [];
    const started = { stop: 0, startNew: 0, steps: [] as number[] };
    const session = {
      entries,
      busy: false,
      send: async (text: string, images: readonly ChatImage[] = []) => {
        sends.push([text, images]);
      },
      stop: () => {
        started.stop++;
      },
      retry: async () => undefined,
      subscribe: (listener: (change: SessionChange) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as unknown as AiCore['session'] & Pick<ChatSession, 'busy'>;
    const core: AiCore = {
      session,
      edits: {
        subscribe: () => () => undefined,
        pending: () => [],
        position: () => 0,
        outcome: () => null,
        acceptEdit: () => undefined,
        rejectEdit: () => undefined,
        revealEdit: () => undefined,
        step: (direction) => {
          started.steps.push(direction);
        },
        accept: () => undefined,
        reject: () => undefined,
        placement: async () => {
          throw new Error('No place in this test');
        },
        forget: () => undefined,
        placeReply: async () => {
          throw new Error('No place in this test');
        },
      },
      keeper: {
        current: 'c1',
        list: async () => [
          { id: 'c1', title: '', updatedAt: Date.now(), messageCount: 2 },
        ],
        open: async () => true,
        remove: async () => undefined,
        startNew: () => {
          started.startNew++;
        },
        flush: () => undefined,
      },
      approvals: {
        request: () => null,
        answer: () => undefined,
        subscribe: () => () => undefined,
      },
    };
    return {
      core,
      entries,
      sends,
      started,
      emit: (change) => {
        for (const listener of listeners) listener(change);
      },
    };
  }

  const host = (opened: Array<string | undefined> = []) => ({
    editor: {} as never,
    sourceSelection: () => null,
    flushSource: () => undefined,
    followSource: () => undefined,
    documentPath: () => '/notes/draft.md',
    openSettings: (service?: string) => {
      opened.push(service);
    },
  });

  const message = (op: string, data: Record<string, unknown> = {}) => ({
    type: 'panel',
    panel: 'ai',
    op,
    ...data,
  });

  beforeEach(() => {
    posted.length = 0;
  });

  test('opening sends the state and the whole conversation', () => {
    const { core } = stub([asked('Hi')]);
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('open'));
    expect(sent('state')).toHaveLength(1);
    const entries = sent('entries');
    expect(entries).toHaveLength(1);
    expect((entries[0]?.entries as unknown[]).length).toBe(1);
    panel.destroy();
  });

  test('nothing is sent while the sheet is down', () => {
    const { core, emit } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    emit({ kind: 'added', entry: asked('Hi') });
    expect(posted).toEqual([]);
    panel.destroy();
  });

  test('send hands the text and the attached images to the session', async () => {
    const { core, sends } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    changeSettings(withModels());
    panel.handle(message('open'));
    panel.handle(
      message('attach', {
        images: [{ name: 'photo.png', type: 'image/png', data: btoa('abc') }],
      })
    );
    await frame();
    const state = sent('state').at(-1) as { composer?: { images: unknown[] } };
    expect(state.composer?.images).toHaveLength(1);

    panel.handle(message('send', { text: 'What is this?' }));
    expect(sends).toHaveLength(1);
    expect(sends[0]?.[0]).toBe('What is this?');
    expect(sends[0]?.[1]).toHaveLength(1);
    expect(sends[0]?.[1][0]?.name).toBe('photo.png');

    panel.handle(message('send', { text: 'Again' }));
    expect(sends[1]?.[1]).toEqual([]);
    panel.destroy();
  });

  test('an empty message is not sent', () => {
    const { core, sends } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('send', { text: '   ' }));
    expect(sends).toEqual([]);
    panel.destroy();
  });

  test('a suggestion sends its words', () => {
    const { core, sends } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('suggestion', { index: 1 }));
    expect(sends).toEqual([[i18next.t('ai.empty.proofread'), []]]);
    panel.destroy();
  });

  test('a reply on its way is sent at most once a frame', async () => {
    const reading = reply({ parts: [{ type: 'text', text: 'a' }] });
    const { core, emit } = stub([asked('Hi'), reading]);
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('open'));
    posted.length = 0;
    for (const text of ['ab', 'abc', 'abcd']) {
      reading.parts = [{ type: 'text', text }];
      emit({ kind: 'updated', entry: reading });
    }
    expect(sent('entry')).toHaveLength(0);
    await frame();
    const entries = sent('entry');
    expect(entries).toHaveLength(1);
    const data = entries[0]?.entry as AssistantEntryData;
    expect(data.id).toBe(2);
    expect(JSON.stringify(data.parts)).toContain('abcd');

    reading.status = 'done';
    emit({ kind: 'updated', entry: reading });
    expect(sent('entry')).toHaveLength(2);
    panel.destroy();
  });

  test('a removed reply is dropped from the sheet', () => {
    const reading = reply();
    const { core, emit } = stub([asked('Hi'), reading]);
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('open'));
    emit({ kind: 'removed', entry: reading });
    expect(sent('removed')).toEqual([
      { type: 'panel', panel: 'ai', op: 'removed', id: 2 },
    ]);
    panel.destroy();
  });

  test('copy gives back the text of the reply', () => {
    const done = reply({
      status: 'done',
      parts: [
        { type: 'reasoning', text: 'hmm' },
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' there' },
      ],
    });
    const { core } = stub([asked('Hi'), done]);
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('copy', { entry: 2 }));
    expect(sent('copy')).toEqual([
      { type: 'panel', panel: 'ai', op: 'copy', text: 'Hello there' },
    ]);
    panel.destroy();
  });

  test('the history lists the kept conversations', async () => {
    const { core } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('history'));
    await frame();
    const history = sent('history')[0] as {
      items: Array<{ id: string; title: string; current: boolean }>;
    };
    expect(history.items).toEqual([
      {
        id: 'c1',
        title: i18next.t('ai.history.untitled'),
        detail: expect.any(String),
        current: true,
      },
    ]);
    panel.destroy();
  });

  test('the settings open at once while the sheet is down, and after it goes while it is up', () => {
    const opened: Array<string | undefined> = [];
    const { core } = stub();
    const panel = new NativeAiPanel(host(opened), core, quiet);
    panel.handle(message('service', { id: 'openai' }));
    expect(opened).toEqual(['openai']);

    opened.length = 0;
    panel.handle(message('open'));
    posted.length = 0;
    panel.handle(message('settings'));
    expect(opened).toEqual([]);
    expect(sent('hide')).toHaveLength(1);
    panel.handle(message('close'));
    expect(opened).toEqual([undefined]);
    panel.destroy();
  });

  test('stop, new chat and the review steps reach the conversation', () => {
    const { core, started } = stub();
    const panel = new NativeAiPanel(host(), core, quiet);
    panel.handle(message('stop'));
    panel.handle(message('newChat'));
    panel.handle(message('review', { action: 'next' }));
    panel.handle(message('review', { action: 'prev' }));
    expect(started.stop).toBe(1);
    expect(started.startNew).toBe(1);
    expect(started.steps).toEqual([1, -1]);
    panel.destroy();
  });
});
