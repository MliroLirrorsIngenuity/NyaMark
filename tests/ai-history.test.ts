import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { history } from '@milkdown/kit/prose/history';
import {
  EditorState,
  type PluginView,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MockLanguageModelV4 } from 'ai/test';
import {
  type AssistantEntry,
  type ChatEntry,
  ChatSession,
  type SessionChange,
  type UserEntry,
  replyText,
} from '../src/ai/agent/session';
import { EditController } from '../src/ai/edit/controller';
import { readSavedEdits } from '../src/ai/edit/saved-edits';
import { replaceText } from '../src/ai/edit/text-edit';
import { ConversationKeeper } from '../src/ai/history/keeper';
import {
  CONVERSATION_VERSION,
  type Conversation,
  type SaveImage,
  conversationTitle,
  packConversation,
  unpackConversation,
} from '../src/ai/history/saved';
import { ConversationStore, type HistoryApi } from '../src/ai/history/store';
import type { ChatImage } from '../src/ai/images/image';
import type { ConversationSummary } from '../src/bridge/ipc/ai';
import type { NyaEditor } from '../src/editor/editor';
import { proposalsPlugin } from '../src/editor/plugins/ai-proposals';
import { env, parse, serialize } from './ai-edit-helpers';

type DoStream = MockLanguageModelV4['doStream'];
type StreamPart = Awaited<
  ReturnType<DoStream>
>['stream'] extends ReadableStream<infer Part>
  ? Part
  : never;

const finish = (): StreamPart => ({
  type: 'finish',
  usage: {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  },
  finishReason: { unified: 'stop', raw: 'stop' },
});

const reply = (text: string): StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  finish(),
];

function streamOf(parts: StreamPart[]) {
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

/** A model that answers every message with `Done.` */
const doneModel = () =>
  new MockLanguageModelV4({ doStream: async () => streamOf(reply('Done.')) });

/** A model that says `Half` and waits to be aborted or let finish. */
function stallingModel() {
  let release = () => {};
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't' });
          controller.enqueue({ type: 'text-delta', id: 't', delta: 'Half' });
          abortSignal?.addEventListener('abort', () => {
            controller.error(abortSignal.reason);
          });
          release = () => {
            controller.enqueue({ type: 'text-end', id: 't' });
            controller.enqueue(finish());
            controller.close();
          };
        },
      }),
    }),
  });
  return { model, release: () => release() };
}

const sessionWith = (model: MockLanguageModelV4) =>
  new ChatSession(() => ({
    model,
    modelLabel: 'mock-model',
    instructions: 'Be brief.',
  }));

/** Resolves once the reply under way has shown some text. */
function firstText(session: ChatSession): Promise<void> {
  return new Promise((resolve) => {
    const stop = session.subscribe((change) => {
      if (
        change.kind === 'updated' &&
        change.entry.role === 'assistant' &&
        replyText(change.entry)
      ) {
        stop();
        resolve();
      }
    });
  });
}

/** Bytes that read as a PNG, told apart by `seed`. */
const png = (seed: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const user = (
  id: number,
  text: string,
  images: ChatImage[] = []
): UserEntry => ({ id, role: 'user', text, images });

/** Images kept by their content, as the app keeps them. */
function imageShelf() {
  const kept = new Map<string, Uint8Array>();
  const save: SaveImage = async (bytes) => {
    const id = hex(bytes);
    kept.set(id, bytes.slice());
    return id;
  };
  const read = async (id: string) => kept.get(id) ?? null;
  return { kept, save, read };
}

/** The conversation as written to disk and read back from it. */
const onDisk = async (conversation: Conversation, save: SaveImage) =>
  JSON.parse(JSON.stringify(await packConversation(conversation)(save)));

function sample(): Conversation {
  const shot = png(1);
  const image: ChatImage = {
    name: 'shot.png',
    mediaType: 'image/png',
    data: shot,
    width: 2,
    height: 1,
  };
  const answer: AssistantEntry = {
    id: 2,
    role: 'assistant',
    parts: [
      {
        type: 'tool',
        id: 'call-1',
        name: 'view_image',
        input: { src: 'cat.png' },
        state: 'done',
        output: { image: png(2), mediaType: 'image/png' },
      },
      { type: 'text', text: 'A cat.' },
    ],
    status: 'done',
    model: 'mock-model',
    historyStart: 1,
    usage: { input: 10, output: 5 },
  };
  return {
    title: 'Look at this',
    createdAt: 1000,
    updatedAt: 2000,
    entries: [user(1, 'Look at this', [image]), answer],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'shot.png',
            data: { type: 'data', data: shot },
          },
          { type: 'text', text: 'Look at this' },
        ],
      },
      { role: 'assistant', content: 'A cat.' },
    ],
    edits: { tallies: {}, pending: null },
  };
}

describe('a conversation kept on disk', () => {
  test('is titled with the start of what the user first asked', () => {
    expect(conversationTitle([])).toBe('');
    expect(
      conversationTitle([user(1, '  '), user(2, 'Fix\n  the   intro ')])
    ).toBe('Fix the intro');
    const long = conversationTitle([user(1, 'word '.repeat(40))]);
    expect(long).toHaveLength(80);
    expect(long.endsWith('word…')).toBe(true);
  });

  test('reads back as it was, images and all', async () => {
    const shelf = imageShelf();
    const original = sample();
    const json = await onDisk(original, shelf.save);
    expect(JSON.stringify(json)).not.toContain('"0":137');
    expect(shelf.kept.size).toBe(2);
    expect(await unpackConversation(json, shelf.read)).toEqual(original);
  });

  test('reads back without the images no longer kept', async () => {
    const shelf = imageShelf();
    const json = await onDisk(sample(), shelf.save);
    shelf.kept.clear();
    const back = await unpackConversation(json, shelf.read);
    expect(back?.entries[0]).toEqual(user(1, 'Look at this'));
    expect((back?.entries[1] as AssistantEntry).parts[0]).toEqual({
      type: 'tool',
      id: 'call-1',
      name: 'view_image',
      input: { src: 'cat.png' },
      state: 'done',
      output: { mediaType: 'image/png' },
    });
    expect(back?.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[An image that is no longer kept.]' },
        { type: 'text', text: 'Look at this' },
      ],
    });
  });

  test('reads back without the images it could not keep', async () => {
    const json = await onDisk(sample(), async () => {
      throw new Error('disk full');
    });
    const asked: string[] = [];
    const back = await unpackConversation(json, async (id) => {
      asked.push(id);
      return null;
    });
    expect(asked).toEqual([]);
    expect(back?.entries[0]).toEqual(user(1, 'Look at this'));
  });

  test('is the conversation as it was when it was packed', async () => {
    const shelf = imageShelf();
    const conversation = sample();
    const pack = packConversation(conversation);
    conversation.entries.push(user(3, 'Later'));
    (conversation.entries[0] as UserEntry).text = 'Changed';
    conversation.messages.length = 0;
    const json = await pack(shelf.save);
    expect(json.messages).toHaveLength(2);
    expect((json.messages as UserEntry[])[0]?.text).toBe('Look at this');
    expect(json.history).toHaveLength(2);
  });

  test('reads back what was under way as stopped', async () => {
    const json = {
      version: CONVERSATION_VERSION,
      title: 'Go',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { id: 1, role: 'user', text: 'Go', images: [] },
        {
          id: 2,
          role: 'assistant',
          model: 'm',
          status: 'streaming',
          historyStart: 9,
          parts: [
            {
              type: 'tool',
              id: 'c',
              name: 'web_search',
              input: {},
              state: 'running',
            },
            { type: 'text', text: 'Half' },
            { type: 'unknown' },
          ],
        },
        {
          id: 3,
          role: 'assistant',
          model: 'm',
          status: 'thinking',
          historyStart: -2,
          parts: [],
        },
        { id: 'x', role: 'user', text: 'Not an entry' },
      ],
      history: [{ role: 'user', content: 'Go' }],
      edits: null,
    };
    const back = await unpackConversation(json, async () => null);
    const entries: ChatEntry[] = [
      user(1, 'Go'),
      {
        id: 2,
        role: 'assistant',
        model: 'm',
        status: 'stopped',
        historyStart: 1,
        parts: [
          {
            type: 'tool',
            id: 'c',
            name: 'web_search',
            input: {},
            state: 'stopped',
          },
          { type: 'text', text: 'Half' },
        ],
      },
      {
        id: 3,
        role: 'assistant',
        model: 'm',
        status: 'stopped',
        historyStart: 0,
        parts: [],
      },
    ];
    expect(back?.entries).toEqual(entries);
  });

  test('reads as none when it is no conversation of this version', async () => {
    const read = async () => null;
    expect(await unpackConversation(null, read)).toBeNull();
    expect(await unpackConversation('text', read)).toBeNull();
    expect(await unpackConversation([], read)).toBeNull();
    expect(await unpackConversation({ title: 'Untold' }, read)).toBeNull();
    expect(
      await unpackConversation({ version: CONVERSATION_VERSION + 1 }, read)
    ).toBeNull();
    expect(
      await unpackConversation(
        { version: 1, history: [{ role: 'robot', content: '' }] },
        read
      )
    ).toBeNull();
    expect(
      await unpackConversation(
        {
          version: 1,
          history: [
            { role: 'assistant', content: [{ type: 'tool-call', input: {} }] },
          ],
        },
        read
      )
    ).toBeNull();
    expect(
      await unpackConversation(
        { version: 1, history: [{ role: 'tool', content: 'Done.' }] },
        read
      )
    ).toBeNull();
    expect(await unpackConversation({ version: 1 }, read)).toEqual({
      title: '',
      createdAt: 0,
      updatedAt: 0,
      entries: [],
      messages: [],
      edits: null,
    });
  });
});

describe('a chat session kept and opened again', () => {
  test('goes on from where it was', async () => {
    const first = sessionWith(doneModel());
    await first.send('Hi');
    const kept = first.saved();
    expect(kept.entries.map((entry) => entry.id)).toEqual([1, 2]);
    expect(kept.messages).toHaveLength(2);

    const model = doneModel();
    const second = sessionWith(model);
    const changes: SessionChange['kind'][] = [];
    second.subscribe((change) => changes.push(change.kind));
    second.restore(kept.entries, kept.messages);
    expect(changes).toEqual(['reset']);
    await second.send('And now?');
    expect(second.entries.map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.filter((message) => message.role === 'user')).toHaveLength(2);
  });

  test('keeps no reply still on its way', async () => {
    const { model, release } = stallingModel();
    const session = sessionWith(model);
    const sending = session.send('Hi');
    await firstText(session);
    const kept = session.saved();
    expect(kept.entries).toEqual([user(1, 'Hi')]);
    expect(kept.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    release();
    await sending;
    expect(session.saved().entries).toHaveLength(2);
  });

  test('stops a reply on its way for the one opened', async () => {
    const { model } = stallingModel();
    const session = sessionWith(model);
    const sending = session.send('Hi');
    await firstText(session);
    session.restore([user(1, 'Old')], [{ role: 'user', content: 'Old' }]);
    await sending;
    expect(session.busy).toBe(false);
    expect(session.entries).toEqual([user(1, 'Old')]);
    expect(session.messages).toEqual([{ role: 'user', content: 'Old' }]);
  });
});

const controllers: EditController[] = [];
const keepers: ConversationKeeper[] = [];

afterEach(() => {
  for (const keeper of keepers.splice(0)) keeper.destroy();
  for (const controller of controllers.splice(0)) controller.destroy();
  setSystemTime();
});

/** A controller on an editor that is no more than its state. */
function setup(text: string, editTag?: string) {
  let pluginViews: PluginView[] = [];
  const view = {
    state: EditorState.create({
      doc: parse(text),
      plugins: [history(), proposalsPlugin()],
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
    editMode: () => 'review',
    editTag,
  });
  controllers.push(controller);
  return {
    controller,
    text: () => serialize(view.state.doc),
    replace: (from: string, to: string) =>
      controller.edit((current) => replaceText(current, from, to)),
  };
}

const TEXT = 'one two three\n\nsecond paragraph\n';

/** The edits of a conversation with `two` made `TWO`, as kept on disk. */
async function keptEdits() {
  const first = setup(TEXT);
  await first.replace('two', 'TWO');
  const kept = JSON.parse(JSON.stringify(first.controller.save()));
  first.controller.destroy();
  return kept;
}

describe('the edits of a conversation kept and opened again', () => {
  test('show the changes waiting where the document reads the same', async () => {
    const kept = await keptEdits();
    expect(kept.tallies).toEqual({
      e1: { total: 1, accepted: 0, rejected: 0, dropped: 0, replaced: 0 },
    });
    expect(kept.pending.text).toBe(TEXT);

    const { controller, text } = setup(TEXT);
    await controller.restore(kept);
    expect(controller.outcome('e1')).toMatchObject({ total: 1, pending: 1 });
    controller.acceptEdit('e1');
    expect(text()).toBe('one TWO three\n\nsecond paragraph\n');
    expect(controller.outcome('e1')).toMatchObject({ accepted: 1, pending: 0 });
    expect(await controller.notices()).toContain(
      'The user accepted 1 change of edit e1.'
    );
  });

  test('count the changes as dropped where the document reads otherwise', async () => {
    const kept = await keptEdits();
    const { controller } = setup('one two three\n\nanother paragraph\n');
    await controller.restore(kept);
    expect(controller.pending()).toHaveLength(0);
    expect(controller.outcome('e1')).toMatchObject({
      total: 1,
      dropped: 1,
      pending: 0,
    });
  });

  test('count a change as dropped when it no longer reads', async () => {
    const kept = await keptEdits();
    kept.pending.hunks[0].insert = { content: [{ type: 'nonsense' }] };
    const { controller } = setup(TEXT);
    await controller.restore(kept);
    expect(controller.outcome('e1')).toMatchObject({ dropped: 1, pending: 0 });
  });

  test('show the changes beside those of another conversation', async () => {
    const kept = await keptEdits();
    const { controller } = setup(TEXT, 'bbbb');
    await controller.edit((current) =>
      replaceText(current, 'second', 'Second')
    );
    await controller.restore(kept);
    expect(controller.pending().map((hunk) => hunk.edit)).toEqual([
      'e1',
      'e1-bbbb',
    ]);
  });

  test('count a change as dropped where another waits', async () => {
    const kept = await keptEdits();
    const { controller } = setup(TEXT, 'cccc');
    await controller.edit((current) => replaceText(current, 'two', 'Two'));
    await controller.restore(kept);
    expect(controller.pending().map((hunk) => hunk.edit)).toEqual(['e1-cccc']);
    expect(controller.outcome('e1')).toMatchObject({ dropped: 1, pending: 0 });
  });

  test('leave an edit the window knows as it is', async () => {
    const { controller, replace } = setup(TEXT);
    await replace('two', 'TWO');
    const kept = JSON.parse(JSON.stringify(controller.save()));
    controller.reset();
    expect(controller.save()).toEqual({ tallies: {}, pending: null });
    await controller.restore(kept);
    expect(controller.pending()).toHaveLength(1);
    expect(controller.outcome('e1')).toMatchObject({ dropped: 0, pending: 1 });
    expect(JSON.parse(JSON.stringify(controller.save()))).toEqual(kept);
  });

  test('read back only what reads as kept edits', () => {
    const tally = {
      total: 1,
      accepted: 0,
      rejected: 0,
      dropped: 0,
      replaced: 0,
    };
    const hunk = {
      edit: 'e1',
      from: 1,
      to: 2,
      kind: 'inline',
      insert: {},
      base: [],
    };
    expect(readSavedEdits(null)).toBeNull();
    expect(readSavedEdits('edits')).toBeNull();
    expect(readSavedEdits([])).toBeNull();
    expect(
      readSavedEdits({
        tallies: { e1: tally, e2: { ...tally, total: -1 }, e3: 'all' },
        pending: {
          text: 'a',
          hunks: [
            hunk,
            { ...hunk, from: 3 },
            { ...hunk, kind: 'table' },
            { ...hunk, edit: 4 },
          ],
        },
      })
    ).toEqual({
      tallies: { e1: tally },
      pending: { text: 'a', hunks: [hunk] },
    });
    expect(
      readSavedEdits({ pending: { text: 'a', hunks: [{ edit: 'e1' }] } })
    ).toEqual({ tallies: {}, pending: null });
  });
});

const DRAFT = '(draft)';

/** Conversations kept in memory as the app keeps them on disk. */
function memoryApi() {
  const documents = new Map<string, Map<string, unknown>>();
  const images = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const name = (document: string | null) => document ?? DRAFT;
  const of = (document: string | null) => {
    let found = documents.get(name(document));
    if (!found) {
      found = new Map();
      documents.set(name(document), found);
    }
    return found;
  };
  const api: HistoryApi = {
    async list(document) {
      const summaries: ConversationSummary[] = [];
      for (const [id, value] of documents.get(name(document)) ?? []) {
        const kept = value as {
          title: string;
          updatedAt: number;
          messages: unknown[];
        };
        summaries.push({
          id,
          title: kept.title,
          updatedAt: kept.updatedAt,
          messageCount: kept.messages.length,
        });
      }
      return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async read(document, id) {
      const value = documents.get(name(document))?.get(id);
      if (value === undefined) throw new Error(`missing: ${id}`);
      return structuredClone(value);
    },
    async write(document, id, value) {
      calls.push(`write ${name(document)} ${id}`);
      of(document).set(id, JSON.parse(JSON.stringify(value)));
    },
    async delete(document, id) {
      documents.get(name(document))?.delete(id);
    },
    async move(from, to) {
      calls.push(`move ${name(from)} ${name(to)}`);
      for (const [id, value] of documents.get(name(from)) ?? []) {
        of(to).set(id, value);
      }
      documents.delete(name(from));
      for (const [key, bytes] of [...images]) {
        if (!key.startsWith(`${name(from)}/`)) continue;
        images.delete(key);
        images.set(`${name(to)}${key.slice(name(from).length)}`, bytes);
      }
    },
    async clear() {
      documents.clear();
      images.clear();
    },
    async saveImage(document, id, bytes) {
      calls.push('image');
      const image = hex(bytes);
      images.set(`${name(document)}/${id}/${image}`, bytes.slice());
      return image;
    },
    async readImage(document, id, image) {
      const bytes = images.get(`${name(document)}/${id}/${image}`);
      if (!bytes) throw new Error(`missing: ${image}`);
      return bytes;
    },
  };
  return { api, documents, calls };
}

const NO_EDITS = { tallies: {}, pending: null };

/** The edit controller as the keeper sees it. */
function fakeEdits() {
  const listeners = new Set<() => void>();
  let kept: unknown = NO_EDITS;
  const restored: unknown[] = [];
  const edits = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    save: () => kept,
    async restore(saved: unknown) {
      restored.push(saved);
      kept = saved;
    },
    reset() {
      kept = NO_EDITS;
    },
  };
  return {
    edits: edits as unknown as EditController,
    restored,
    change(next: unknown) {
      kept = next;
      for (const listener of listeners) listener();
    },
  };
}

function keeperFor(
  store: ConversationStore,
  options: { path?: string | null; enabled?: boolean } = {}
) {
  const session = sessionWith(doneModel());
  const edits = fakeEdits();
  let switches = 0;
  const keeper = new ConversationKeeper({
    session,
    edits: edits.edits,
    documentPath: () => options.path ?? null,
    enabled: () => options.enabled ?? true,
    switched: () => {
      switches++;
    },
    store,
  });
  keepers.push(keeper);
  return { session, edits, keeper, switches: () => switches };
}

const ONE_EDIT = {
  tallies: {
    e1: { total: 1, accepted: 1, rejected: 0, dropped: 0, replaced: 0 },
  },
  pending: null,
};

describe("a document's conversations", () => {
  test('are kept as the user talks', async () => {
    const memory = memoryApi();
    const store = new ConversationStore(memory.api);
    const { session, keeper } = keeperFor(store, { path: '/notes/a.md' });
    await session.send('Hello there');
    expect(await store.list()).toMatchObject([
      { id: keeper.current, title: 'Hello there', messageCount: 2 },
    ]);
    expect(new Set(memory.calls)).toEqual(
      new Set([`write /notes/a.md ${keeper.current}`])
    );
  });

  test('keep what became of the edits once they settle', async () => {
    const memory = memoryApi();
    const store = new ConversationStore(memory.api);
    const { session, edits, keeper } = keeperFor(store);
    await session.send('Edit it');
    await store.list();
    const writes = memory.calls.length;
    edits.change(ONE_EDIT);
    keeper.flush();
    edits.change(ONE_EDIT);
    keeper.flush();
    await store.list();
    expect(memory.calls).toHaveLength(writes + 1);
    const kept = memory.documents.get(DRAFT)?.get(keeper.current);
    expect(kept).toMatchObject({ edits: ONE_EDIT });
  });

  test('open again in a window for the document, the latest first', async () => {
    const memory = memoryApi();
    setSystemTime(new Date('2026-10-05T10:00:00Z'));
    const first = keeperFor(new ConversationStore(memory.api), {
      path: '/a.md',
    });
    await first.session.send('First question');
    first.edits.change(ONE_EDIT);
    const earlier = first.keeper.current;
    first.keeper.startNew();
    setSystemTime(new Date('2026-10-05T10:05:00Z'));
    await first.session.send('Second question');
    const latest = first.keeper.current;
    await first.keeper.list();

    const second = keeperFor(new ConversationStore(memory.api), {
      path: '/a.md',
    });
    await second.keeper.openLatest();
    expect(second.keeper.current).toBe(latest);
    expect(second.session.entries[0]).toMatchObject({
      role: 'user',
      text: 'Second question',
    });
    expect(second.edits.restored).toEqual([NO_EDITS]);

    expect(await second.keeper.open(earlier)).toBe(true);
    expect(second.keeper.current).toBe(earlier);
    expect(second.session.entries[0]).toEqual(user(1, 'First question'));
    expect(second.edits.restored.at(-1)).toEqual(ONE_EDIT);
    expect(second.switches()).toBe(2);
  });

  test('leave the conversation the user started in place of the latest', async () => {
    const memory = memoryApi();
    const first = keeperFor(new ConversationStore(memory.api));
    await first.session.send('Earlier');
    await first.keeper.list();

    const second = keeperFor(new ConversationStore(memory.api));
    const opening = second.keeper.openLatest();
    const sending = second.session.send('Already typing');
    await opening;
    await sending;
    expect(second.session.entries[0]).toEqual(user(1, 'Already typing'));
    expect(second.edits.restored).toEqual([]);
  });

  test('go along with their document when it is saved elsewhere', async () => {
    const memory = memoryApi();
    const store = new ConversationStore(memory.api);
    const { session, keeper } = keeperFor(store);
    const sending = session.send('Draft talk');
    const moving = store.documentMoved(null, '/saved.md');
    await sending;
    await moving;
    await store.list();
    const id = keeper.current;
    expect(memory.calls[0]).toBe(`write ${DRAFT} ${id}`);
    expect(memory.calls[1]).toBe(`move ${DRAFT} /saved.md`);
    expect(memory.calls.at(-1)).toBe(`write /saved.md ${id}`);
    expect(memory.documents.has(DRAFT)).toBe(false);
    expect([...(memory.documents.get('/saved.md')?.keys() ?? [])]).toEqual([
      id,
    ]);
  });

  test('keep each image once, and read it back', async () => {
    const memory = memoryApi();
    const image: ChatImage = {
      name: 'a.png',
      mediaType: 'image/png',
      data: png(7),
      width: 1,
      height: 1,
    };
    const first = keeperFor(new ConversationStore(memory.api));
    await first.session.send('Look', [image]);
    await first.keeper.list();
    expect(memory.calls.filter((call) => call === 'image')).toHaveLength(1);

    const second = keeperFor(new ConversationStore(memory.api));
    await second.keeper.openLatest();
    expect(second.session.entries[0]).toEqual(user(1, 'Look', [image]));
    await second.session.send('And this?');
    await second.keeper.list();
    expect(memory.calls.filter((call) => call === 'image')).toHaveLength(1);
  });

  test('are kept none while keeping is off', async () => {
    const memory = memoryApi();
    const { session } = keeperFor(new ConversationStore(memory.api), {
      enabled: false,
    });
    await session.send('Between us');
    expect(memory.calls).toEqual([]);
  });

  test('start over in the panel when the one shown is deleted', async () => {
    const memory = memoryApi();
    const store = new ConversationStore(memory.api);
    const { session, keeper, switches } = keeperFor(store);
    await session.send('One');
    const id = keeper.current;
    await keeper.remove(id);
    expect(session.entries).toEqual([]);
    expect(keeper.current).not.toBe(id);
    expect(switches()).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  test('start over in the panel when every one is deleted', async () => {
    const memory = memoryApi();
    const store = new ConversationStore(memory.api);
    const { session, keeper } = keeperFor(store);
    await session.send('Two');
    const id = keeper.current;
    await store.clear();
    expect(session.entries).toEqual([]);
    expect(keeper.current).not.toBe(id);
    expect(await store.list()).toEqual([]);
  });
});
