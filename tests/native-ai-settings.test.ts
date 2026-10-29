import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { AI_PRESETS } from '../src/ai/providers/presets';
import * as realAi from '../src/bridge/ipc/ai';
import type { AiSecretStatus } from '../src/bridge/ipc/ai';
import type {
  FormRow,
  FormSection,
  NativeForm,
} from '../src/features/native/form';
import en from '../src/i18n/locales/en.json';
import {
  type AiModelInfo,
  type AiProvider,
  type AiSettings,
  defaultAiSettings,
} from '../src/state/ai-settings';

const calls = {
  secrets: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  cleared: 0,
};

const saved: AiSecretStatus = {
  saved: true,
  hasKey: true,
  origin: 'https://api.openai.com',
  auth: 'bearer',
  hint: 'abcd',
  storage: 'keychain',
};

mock.module('../src/bridge/ipc/ai', () => ({
  ...realAi,
  getAiSecretStatus: async () => saved,
  chatGptStatus: async () => ({ signedIn: false, email: null }),
  setAiSecret: async (request: Record<string, unknown>) => {
    calls.secrets.push(request);
    return { ...saved, hasKey: request.key !== null };
  },
  deleteAiSecret: async (profile: string) => {
    calls.deleted.push(profile);
  },
  webAddressIsPublic: async () => false,
  clearConversations: async () => {
    calls.cleared += 1;
  },
  mcpSync: async () => [],
  mcpStatus: async () => [],
  mcpRestart: async () => ({}),
  onMcpStatusChange: async () => () => {},
}));

Object.assign(globalThis, { window: globalThis });

const { i18next } = await import('../src/i18n');
await i18next.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const { createNativeAiTab } = await import(
  '../src/features/native/settings-ai'
);

const model = (id: string): AiModelInfo => ({
  id,
  vision: false,
  tools: true,
  reasoning: false,
  contextWindow: 128_000,
});

const service = (patch: Partial<AiProvider> = {}): AiProvider => ({
  id: 'p-one',
  name: 'My OpenAI',
  preset: 'openai',
  kind: 'openai',
  auth: 'key',
  baseUrl: 'https://api.openai.com/v1',
  models: [model('gpt-a'), model('gpt-b')],
  ...patch,
});

const settings = (patch: Partial<AiSettings> = {}): AiSettings => ({
  ...structuredClone(defaultAiSettings),
  providers: [service()],
  chatModel: { provider: 'p-one', model: 'gpt-a' },
  ...patch,
});

let answer = 'delete';

function open(start: AiSettings = settings()) {
  const changes: AiSettings[] = [];
  const pushed: string[] = [];
  const popped: string[] = [];
  const form = {
    refresh: () => {},
    alert: async () => answer,
  } as unknown as NativeForm;
  const tab = createNativeAiTab(start, (next) => changes.push(next), {
    proxy: () => ({ mode: 'system' }),
    form,
    push: (id) => pushed.push(id),
    pop: (id) => popped.push(id),
  });
  return { tab, changes, pushed, popped };
}

const rowsOf = (sections: FormSection[]) =>
  sections.flatMap((section) => section.rows);

function find<K extends FormRow['kind']>(
  rows: FormRow[],
  id: string,
  kind: K
): Extract<FormRow, { kind: K }> {
  const row = rows.find((entry) => entry.id === id);
  expect(row?.kind).toBe(kind);
  return row as Extract<FormRow, { kind: K }>;
}

beforeEach(() => {
  calls.secrets = [];
  calls.deleted = [];
  calls.cleared = 0;
  answer = 'delete';
});

describe('the sections', () => {
  test('list the services as items and hold the chat model', () => {
    const { tab } = open();
    const sections = tab.sections();
    expect(sections.map((section) => section.id)).toEqual([
      'ai.services',
      'ai.defaults',
      'ai.quick',
      'ai.complete',
      'ai.network',
      'ai.mcp',
      'ai.custom',
      'ai.history',
    ]);

    const services = sections[0].rows.filter((row) => row.kind === 'item');
    expect(services.map((row) => row.id)).toEqual(['ai.service.p-one']);
    expect(services[0]).toMatchObject({
      kind: 'item',
      title: 'My OpenAI',
      detail: 'https://api.openai.com/v1 · 2 models',
    });

    const chat = find(rowsOf(sections), 'ai.chatModel', 'choice');
    const picked = chat.options.find((option) => option.value === chat.value);
    expect(picked?.label).toBe('My OpenAI · gpt-a');
  });

  test('offer none for a model not set', () => {
    const { tab } = open(settings({ chatModel: null }));
    const chat = find(rowsOf(tab.sections()), 'ai.chatModel', 'choice');
    expect(chat.value).toBe('none');
    expect(chat.options[0]).toMatchObject({ value: 'none', label: 'None' });
  });

  test('show the manual proxy address and SearXNG address once chosen', () => {
    const { tab } = open();
    expect(rowsOf(tab.sections()).some((row) => row.id === 'ai.proxyUrl')).toBe(
      false
    );
    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.proxy',
      value: 'manual',
    });
    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.searchEngine',
      value: 'searxng',
    });
    const rows = rowsOf(tab.sections());
    expect(find(rows, 'ai.proxyUrl', 'text').input).toBe('url');
    expect(find(rows, 'ai.searxngUrl', 'text').input).toBe('url');
  });
});

describe('addService', () => {
  test('adds the service from the preset and pushes its page', async () => {
    const preset = AI_PRESETS.find((entry) => entry.id === 'anthropic');
    expect(preset).toBeDefined();
    const { tab, changes, pushed } = open();

    tab.addService('anthropic');
    await tab.settled();

    const added = changes.at(-1)?.providers.at(-1);
    expect(changes.at(-1)?.providers).toHaveLength(2);
    expect(added).toMatchObject({
      preset: 'anthropic',
      kind: 'anthropic',
      auth: 'key',
      baseUrl: preset?.baseUrl,
      models: [],
    });
    expect(pushed).toEqual([`ai.service.${added?.id}`]);
    expect(calls.secrets).toEqual([
      {
        profile: added?.id,
        baseUrl: preset?.baseUrl,
        auth: 'x-api-key',
        key: null,
        keepKey: true,
      },
    ]);

    const page = tab.page(pushed[0]);
    expect(page?.id).toBe(pushed[0]);
    const key = find(
      page?.sections.flatMap((section) => section.rows) ?? [],
      'ai.service.key',
      'text'
    );
    expect(key.secure).toBe(true);
    expect(key.input).toBe('code');
  });

  test('opens the service already set up from the preset', () => {
    const { tab, changes, pushed } = open();
    tab.addService('openai');
    expect(changes).toHaveLength(0);
    expect(pushed).toEqual(['ai.service.p-one']);
  });

  test('ignores a preset that does not exist', () => {
    const { tab, changes, pushed } = open();
    tab.addService('nowhere');
    expect(changes).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('adds a presets page entry and moves on to the service', () => {
    const { tab, changes, pushed, popped } = open();
    const add = tab.page('ai.add');
    const links = add?.sections.flatMap((section) => section.rows) ?? [];
    expect(links.map((row) => row.id)).toEqual(
      AI_PRESETS.map((preset) => `ai.add.${preset.id}`)
    );

    tab.handle({ op: 'open', page: 'ai.add', id: 'ai.add.deepseek' });

    expect(changes.at(-1)?.providers.at(-1)?.preset).toBe('deepseek');
    expect(popped).toEqual(['ai.add']);
    expect(pushed).toHaveLength(1);
  });
});

describe('the defaults', () => {
  test('a change on the chat model sends the chosen reference', () => {
    const { tab, changes } = open();
    const chat = find(rowsOf(tab.sections()), 'ai.chatModel', 'choice');
    const second = chat.options.find(
      (option) => option.label === 'My OpenAI · gpt-b'
    );
    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.chatModel',
      value: second?.value ?? '',
    });
    expect(changes.at(-1)?.chatModel).toEqual({
      provider: 'p-one',
      model: 'gpt-b',
    });

    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.chatModel',
      value: 'none',
    });
    expect(changes.at(-1)?.chatModel).toBeNull();
  });

  test('a manual proxy without an address stays on the system proxy', () => {
    const { tab, changes } = open();
    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.proxy',
      value: 'manual',
    });
    expect(changes.at(-1)?.proxy).toEqual({ mode: 'system' });

    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.proxyUrl',
      value: ' http://127.0.0.1:7890 ',
    });
    expect(changes.at(-1)?.proxy).toEqual({
      mode: 'manual',
      url: 'http://127.0.0.1:7890',
    });
  });

  test('SearXNG without an address searches as automatic', () => {
    const { tab, changes } = open();
    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.searchEngine',
      value: 'searxng',
    });
    expect(changes.at(-1)?.search.engine).toBe('auto');

    tab.handle({
      op: 'change',
      page: 'settings',
      id: 'ai.searxngUrl',
      value: 'https://searx.example.org',
    });
    expect(changes.at(-1)?.search).toMatchObject({
      engine: 'searxng',
      searxngUrl: 'https://searx.example.org',
    });
  });
});

describe('a service page', () => {
  const page = 'ai.service.p-one';

  test('saves the key typed and holds it until settled', async () => {
    const { tab } = open();
    tab.handle({
      op: 'change',
      page,
      id: 'ai.service.key',
      value: ' sk-test ',
    });
    await tab.settled();
    expect(calls.secrets).toEqual([
      {
        profile: 'p-one',
        baseUrl: 'https://api.openai.com/v1',
        auth: 'bearer',
        key: 'sk-test',
        keepKey: false,
      },
    ]);
  });

  test('turns a key down while the address is not a web address', async () => {
    const { tab } = open(settings({ providers: [service({ baseUrl: '' })] }));
    tab.handle({ op: 'change', page, id: 'ai.service.key', value: 'sk-test' });
    await tab.settled();
    expect(calls.secrets).toHaveLength(0);
    const rows = rowsOf(tab.page(page)?.sections ?? []);
    expect(find(rows, 'ai.service.key', 'text').error).toBe(
      'Enter an address that starts with https:// or http://.'
    );
  });

  test('switches a model off and on again', () => {
    const { tab, changes } = open();
    tab.page(page);
    tab.handle({ op: 'change', page, id: 'ai.model.gpt-a', value: false });
    expect(changes.at(-1)?.providers[0].models.map((m) => m.id)).toEqual([
      'gpt-b',
    ]);
    expect(changes.at(-1)?.chatModel).toEqual({
      provider: 'p-one',
      model: 'gpt-b',
    });

    tab.handle({ op: 'change', page, id: 'ai.model.gpt-a', value: true });
    expect(changes.at(-1)?.providers[0].models.map((m) => m.id)).toEqual([
      'gpt-b',
      'gpt-a',
    ]);
  });

  test('adds a model typed by its ID', () => {
    const { tab, changes } = open();
    tab.handle({ op: 'change', page, id: 'ai.service.search', value: 'gpt-z' });
    const rows = rowsOf(tab.page(page)?.sections ?? []);
    expect(find(rows, 'ai.service.addModel', 'button').label).toBe(
      'Add model “gpt-z”'
    );

    tab.handle({ op: 'press', page, id: 'ai.service.addModel' });
    expect(changes.at(-1)?.providers[0].models.map((m) => m.id)).toContain(
      'gpt-z'
    );
  });

  test('edits a model on its own page', () => {
    const { tab, changes } = open();
    const modelPage = 'ai.model.p-one.gpt-a';
    tab.handle({
      op: 'change',
      page: modelPage,
      id: 'ai.model.vision',
      value: true,
    });
    tab.handle({
      op: 'change',
      page: modelPage,
      id: 'ai.model.context',
      value: '1.5M',
    });
    const edited = changes.at(-1)?.providers[0].models[0];
    expect(edited).toMatchObject({ vision: true, contextWindow: 1_500_000 });

    tab.handle({
      op: 'change',
      page: modelPage,
      id: 'ai.model.context',
      value: 'many',
    });
    expect(changes).toHaveLength(2);
    expect(tab.page('ai.model.p-one.gone')).toBeNull();
  });

  test('removes the service, its key and the models in use', () => {
    const { tab, changes, popped } = open();
    tab.handle({ op: 'press', page, id: 'ai.service.remove' });
    expect(changes.at(-1)?.providers).toEqual([]);
    expect(changes.at(-1)?.chatModel).toBeNull();
    expect(popped).toEqual([page]);
    expect(calls.deleted).toEqual(['p-one']);
    expect(tab.page(page)).toBeNull();
  });

  test('renames the service and keeps the old name for a blank one', () => {
    const { tab, changes } = open();
    tab.handle({ op: 'change', page, id: 'ai.service.name', value: ' Work ' });
    expect(changes.at(-1)?.providers[0].name).toBe('Work');
    tab.handle({ op: 'change', page, id: 'ai.service.name', value: '  ' });
    expect(changes.at(-1)?.providers[0].name).toBe('Work');
  });

  test('stores the address without the slashes that end it', () => {
    const { tab, changes } = open();
    tab.handle({
      op: 'change',
      page,
      id: 'ai.service.baseUrl',
      value: ' https://example.com/v1// ',
    });
    expect(changes.at(-1)?.providers[0].baseUrl).toBe('https://example.com/v1');
  });
});

describe('the AI menu commands', () => {
  test('move, remove, add and reset', () => {
    const { tab, changes, pushed } = open();
    const ids = () => changes.at(-1)?.quickActions.map((action) => action.id);

    tab.handle({
      op: 'action',
      page: 'settings',
      id: 'ai.quick.item.polish',
      action: 'down',
    });
    expect(ids()?.slice(0, 2)).toEqual(['rewrite', 'polish']);

    tab.handle({
      op: 'action',
      page: 'settings',
      id: 'ai.quick.item.rewrite',
      action: 'remove',
    });
    expect(ids()?.[0]).toBe('polish');

    tab.handle({ op: 'press', page: 'settings', id: 'ai.quick.add' });
    const added = changes.at(-1)?.quickActions.at(-1);
    expect(added).toMatchObject({ name: '', prompt: '' });
    expect(pushed).toEqual([`ai.quick.${added?.id}`]);

    tab.handle({
      op: 'change',
      page: pushed[0],
      id: 'ai.quick.prompt',
      value: '  Make a list.  ',
    });
    expect(changes.at(-1)?.quickActions.at(-1)?.prompt).toBe('Make a list.');

    tab.handle({ op: 'press', page: 'settings', id: 'ai.quick.reset' });
    expect(ids()).toEqual(defaultAiSettings.quickActions.map((a) => a.id));
  });
});

describe('the MCP servers', () => {
  test('add a local server, edit it and switch it off', () => {
    const { tab, changes, pushed } = open();
    tab.handle({ op: 'press', page: 'settings', id: 'ai.mcp.addLocal' });
    const server = changes.at(-1)?.mcpServers[0];
    expect(server).toMatchObject({ transport: 'stdio', enabled: true });
    expect(pushed).toEqual([`ai.mcp.${server?.id}`]);

    tab.handle({
      op: 'change',
      page: pushed[0],
      id: 'ai.mcp.command',
      value: ' npx ',
    });
    tab.handle({
      op: 'change',
      page: pushed[0],
      id: 'ai.mcp.args',
      value: '-y\n\n@scope/server\n',
    });
    tab.handle({
      op: 'change',
      page: pushed[0],
      id: 'ai.mcp.env',
      value: 'TOKEN=abc\nBARE',
    });
    expect(changes.at(-1)?.mcpServers[0]).toMatchObject({
      command: 'npx',
      args: ['-y', '@scope/server'],
      env: [
        ['TOKEN', 'abc'],
        ['BARE', ''],
      ],
    });

    const item = find(
      rowsOf(tab.sections()),
      `ai.mcp.item.${server?.id}`,
      'item'
    );
    expect(item).toMatchObject({
      detail: 'npx -y @scope/server',
      toggle: true,
    });

    tab.handle({
      op: 'change',
      page: 'settings',
      id: `ai.mcp.item.${server?.id}`,
      value: false,
    });
    expect(changes.at(-1)?.mcpServers[0].enabled).toBe(false);
  });

  test('send a key typed for a web server once its address is set', async () => {
    const { tab, changes, pushed } = open();
    tab.handle({ op: 'press', page: 'settings', id: 'ai.mcp.addRemote' });
    const page = pushed[0];
    tab.handle({ op: 'change', page, id: 'ai.mcp.useKey', value: true });
    tab.handle({ op: 'change', page, id: 'ai.mcp.key', value: 'token' });
    expect(calls.secrets).toHaveLength(0);

    tab.handle({
      op: 'change',
      page,
      id: 'ai.mcp.url',
      value: 'https://example.com/mcp',
    });
    tab.handle({ op: 'change', page, id: 'ai.mcp.key', value: 'token' });
    await tab.settled();
    const id = changes.at(-1)?.mcpServers[0].id;
    expect(calls.secrets).toEqual([
      {
        profile: `mcp-${id}`,
        baseUrl: 'https://example.com/mcp',
        auth: 'bearer',
        key: 'token',
        keepKey: false,
      },
    ]);
  });
});

describe('the conversations', () => {
  const press = {
    op: 'press',
    page: 'settings',
    id: 'ai.clearHistory',
  } as const;

  test('are deleted once confirmed', async () => {
    const { tab } = open();
    await tab.handle(press);
    expect(calls.cleared).toBe(1);
    const note = find(rowsOf(tab.sections()), 'ai.historyStatus', 'note');
    expect(note.text).toBe('All conversations were deleted.');
  });

  test('stay when the alert is turned down', async () => {
    answer = 'cancel';
    const { tab } = open();
    await tab.handle(press);
    expect(calls.cleared).toBe(0);
  });
});
