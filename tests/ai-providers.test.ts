import { describe, expect, test } from 'bun:test';
import { streamText } from 'ai';
import {
  guessCapabilities,
  isChatModel,
} from '../src/ai/providers/capabilities';
import { checkProvider } from '../src/ai/providers/check';
import { languageModel } from '../src/ai/providers/factory';
import {
  ModelListError,
  listModels,
  parseAnthropicModels,
  parseGoogleModels,
  parseOpenAiModels,
} from '../src/ai/providers/models';
import { AI_PRESETS, authSchemeOf } from '../src/ai/providers/presets';
import { type AiProvider, defaultQuickActions } from '../src/state/ai-settings';
import { normalizeSettings } from '../src/state/settings';

function provider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: 'p-test',
    name: 'Test',
    preset: 'custom',
    kind: 'openai-compatible',
    auth: 'key',
    baseUrl: 'https://api.example.com/v1',
    models: [],
    ...overrides,
  };
}

/** Answers each request from `routes` by its path and query. */
function fakeFetch(
  routes: Record<string, () => Response>,
  seen: string[] = []
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.pathname}${url.search}`;
    seen.push(key);
    const route = routes[key] ?? routes[url.pathname];
    return route ? route() : new Response('{}', { status: 404 });
  }) as typeof fetch;
}

const json =
  (value: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });

describe('AI settings', () => {
  test('start empty, with the system proxy', () => {
    expect(normalizeSettings(undefined).ai).toEqual({
      providers: [],
      chatModel: null,
      quickModel: null,
      completeModel: null,
      proxy: { mode: 'system' },
      instructions: '',
      editMode: 'review',
      search: { engine: 'auto', searxngUrl: '', native: false },
      mcpServers: [],
      quickActions: defaultQuickActions(),
      complete: { enabled: false, delay: 700, atEndOnly: true },
      keepHistory: true,
    });
  });

  test('keep a search engine only when it can be searched', () => {
    const search = (value: unknown) =>
      normalizeSettings({ ai: { search: value } }).ai.search;
    expect(search({ engine: 'bing', native: true })).toEqual({
      engine: 'bing',
      searxngUrl: '',
      native: true,
    });
    expect(search({ engine: 'searxng', searxngUrl: ' ' }).engine).toBe('auto');
    expect(
      search({ engine: 'searxng', searxngUrl: ' https://sx.example ' })
    ).toEqual({
      engine: 'searxng',
      searxngUrl: 'https://sx.example',
      native: false,
    });
    expect(search({ engine: 'google', native: 'yes' })).toEqual({
      engine: 'auto',
      searxngUrl: '',
      native: false,
    });
  });

  test('keep only well-formed providers and models', () => {
    const { ai } = normalizeSettings({
      ai: {
        providers: [
          {
            id: 'p-1',
            name: '  ',
            kind: 'openai',
            baseUrl: ' https://api.openai.com/v1 ',
            models: [
              { id: 'gpt-5', vision: true, contextWindow: 1e12 },
              { id: 'gpt-5', vision: false },
              { id: '' },
              { id: 'tiny', contextWindow: 12 },
            ],
          },
          { id: 'p-1', name: 'Again', kind: 'openai' },
          { id: '../escape', kind: 'openai' },
          { id: 'p-2', kind: 'mystery' },
        ],
      },
    } as never);
    expect(ai.providers).toEqual([
      {
        id: 'p-1',
        name: 'p-1',
        preset: 'custom',
        kind: 'openai',
        auth: 'key',
        baseUrl: 'https://api.openai.com/v1',
        models: [
          {
            id: 'gpt-5',
            vision: true,
            tools: true,
            reasoning: false,
            contextWindow: 10_000_000,
          },
          {
            id: 'tiny',
            vision: false,
            tools: true,
            reasoning: false,
            contextWindow: 128_000,
          },
        ],
      },
    ]);
  });

  test('sign in with ChatGPT only on OpenAI’s own API', () => {
    const { ai } = normalizeSettings({
      ai: {
        providers: [
          {
            id: 'p-1',
            preset: 'chatgpt',
            kind: 'openai',
            auth: 'chatgpt',
            baseUrl: 'https://elsewhere.example/v1',
            models: [{ id: 'gpt-5.5', name: ' GPT-5.5 ' }],
          },
          { id: 'p-2', kind: 'anthropic', auth: 'chatgpt' },
          { id: 'p-3', kind: 'openai', auth: 'mystery' },
        ],
      },
    } as never);
    expect(
      ai.providers.map(({ id, auth, baseUrl }) => ({ id, auth, baseUrl }))
    ).toEqual([
      { id: 'p-1', auth: 'chatgpt', baseUrl: 'https://api.openai.com/v1' },
      { id: 'p-2', auth: 'key', baseUrl: '' },
      { id: 'p-3', auth: 'key', baseUrl: '' },
    ]);
    expect(ai.providers[0].models[0]).toMatchObject({
      id: 'gpt-5.5',
      name: 'GPT-5.5',
    });
  });

  test('drop a chosen model its service no longer has', () => {
    const { ai } = normalizeSettings({
      ai: {
        providers: [
          {
            id: 'p-1',
            kind: 'openai-compatible',
            models: [{ id: 'deepseek-chat' }],
          },
        ],
        chatModel: { provider: 'p-1', model: 'deepseek-chat' },
        quickModel: { provider: 'p-1', model: 'gone' },
      },
    } as never);
    expect(ai.chatModel).toEqual({ provider: 'p-1', model: 'deepseek-chat' });
    expect(ai.quickModel).toBeNull();
  });

  test('read a DeepSeek service saved as a kind of its own', () => {
    const { ai } = normalizeSettings({
      ai: {
        providers: [
          { id: 'p-1', kind: 'deepseek', baseUrl: 'https://api.deepseek.com' },
          { id: 'p-2', preset: 'deepseek', kind: 'deepseek' },
        ],
      },
    } as never);
    expect(ai.providers.map(({ kind, preset }) => ({ kind, preset }))).toEqual([
      { kind: 'openai-compatible', preset: 'deepseek' },
      { kind: 'openai-compatible', preset: 'deepseek' },
    ]);
  });

  test('use the system proxy until a manual one has an address', () => {
    const proxy = (value: unknown) =>
      normalizeSettings({ ai: { proxy: value } } as never).ai.proxy;
    expect(proxy({ mode: 'manual', url: ' ' })).toEqual({ mode: 'system' });
    expect(proxy({ mode: 'manual', url: 'socks5://127.0.0.1:7890' })).toEqual({
      mode: 'manual',
      url: 'socks5://127.0.0.1:7890',
    });
    expect(proxy({ mode: 'none' })).toEqual({ mode: 'none' });
    expect(proxy('direct')).toEqual({ mode: 'system' });
  });

  test('show edits for review unless told to apply them', () => {
    const mode = (value: unknown) =>
      normalizeSettings({ ai: { editMode: value } } as never).ai.editMode;
    expect(mode('auto')).toBe('auto');
    expect(mode('review')).toBe('review');
    expect(mode('yolo')).toBe('review');
    expect(mode(undefined)).toBe('review');
  });

  test('cap the custom instructions', () => {
    const { ai } = normalizeSettings({
      ai: { instructions: 'x'.repeat(30_000) },
    } as never);
    expect(ai.instructions.length).toBe(20_000);
  });
});

describe('presets', () => {
  test('have unique ids and https addresses off this computer', () => {
    const ids = AI_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of AI_PRESETS) {
      if (!preset.baseUrl) continue;
      expect(preset.baseUrl.startsWith('https://')).toBe(!preset.local);
    }
  });

  test('put the key where each API reads it', () => {
    const scheme = (
      kind: AiProvider['kind'],
      auth: AiProvider['auth'] = 'key'
    ) => authSchemeOf({ kind, auth });
    expect(scheme('anthropic')).toBe('x-api-key');
    expect(scheme('google')).toBe('x-goog-api-key');
    expect(scheme('openai')).toBe('bearer');
    expect(scheme('openai-compatible')).toBe('bearer');
    expect(scheme('openai', 'chatgpt')).toBe('chatgpt');
  });
});

describe('capabilities', () => {
  test('leave out models a chat cannot use', () => {
    for (const id of [
      'text-embedding-3-large',
      'whisper-1',
      'tts-1',
      'dall-e-3',
      'gpt-image-1',
      'omni-moderation-latest',
      'gpt-4o-realtime-preview',
    ]) {
      expect(isChatModel(id)).toBe(false);
    }
    for (const id of ['gpt-5', 'claude-sonnet-4-5', 'qwen-max', 'glm-4.6']) {
      expect(isChatModel(id)).toBe(true);
    }
  });

  test('guess from the model id', () => {
    expect(guessCapabilities('claude-sonnet-4-5', { local: false })).toEqual({
      id: 'claude-sonnet-4-5',
      vision: true,
      tools: true,
      reasoning: true,
      contextWindow: 200_000,
    });
    expect(guessCapabilities('gemini-2.5-pro', { local: false })).toMatchObject(
      { vision: true, reasoning: true, contextWindow: 1_000_000 }
    );
    expect(guessCapabilities('deepseek-chat', { local: false })).toMatchObject({
      vision: false,
      reasoning: false,
      contextWindow: 128_000,
    });
    expect(
      guessCapabilities('deepseek-reasoner', { local: false }).reasoning
    ).toBe(true);
    for (const [id, vision] of [
      ['o1', true],
      ['o3-2025-04-16', true],
      ['o4-mini', true],
      ['o1-mini', false],
      ['o1-preview', false],
      ['o3-mini-2025-01-31', false],
    ] as const) {
      expect(guessCapabilities(id, { local: false })).toMatchObject({
        vision,
        reasoning: true,
      });
    }
    expect(guessCapabilities('qwen2.5-vl-7b', { local: true })).toMatchObject({
      vision: true,
      contextWindow: 32_768,
    });
  });

  test('take the window the service gives over the guess', () => {
    expect(
      guessCapabilities('claude-opus-4-1', {
        local: false,
        contextWindow: 1_000_000,
      }).contextWindow
    ).toBe(1_000_000);
  });
});

describe('model lists', () => {
  test('read OpenRouter details from an OpenAI-style list', () => {
    expect(
      parseOpenAiModels({
        data: [
          {
            id: 'anthropic/claude-sonnet-4.5',
            name: 'Claude Sonnet 4.5',
            context_length: 1_000_000,
            architecture: { input_modalities: ['text', 'image'] },
            supported_parameters: ['tools', 'reasoning'],
          },
          { id: 'gpt-5-mini', object: 'model' },
          { object: 'model' },
        ],
      })
    ).toEqual([
      {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        contextWindow: 1_000_000,
        vision: true,
        tools: true,
        reasoning: true,
      },
      {
        id: 'gpt-5-mini',
        name: undefined,
        contextWindow: undefined,
        vision: undefined,
        tools: undefined,
        reasoning: undefined,
      },
    ]);
  });

  test('read Anthropic and Gemini lists', () => {
    expect(
      parseAnthropicModels({
        data: [
          {
            id: 'claude-opus-4-1',
            display_name: 'Claude Opus 4.1',
            max_input_tokens: 200_000,
          },
        ],
      })
    ).toEqual([
      {
        id: 'claude-opus-4-1',
        name: 'Claude Opus 4.1',
        contextWindow: 200_000,
      },
    ]);
    expect(
      parseGoogleModels({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            inputTokenLimit: 1_048_576,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
            thinking: true,
          },
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      })
    ).toEqual([
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1_048_576,
        reasoning: true,
      },
    ]);
  });

  test('follow Anthropic pages', async () => {
    const seen: string[] = [];
    const models = await listModels(
      provider({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1/' }),
      fakeFetch(
        {
          '/v1/models?limit=1000': json({
            data: [{ id: 'a' }],
            has_more: true,
            last_id: 'a',
          }),
          '/v1/models?limit=1000&after_id=a': json({
            data: [{ id: 'b' }],
            has_more: false,
          }),
        },
        seen
      )
    );
    expect(models.map((model) => model.id)).toEqual(['a', 'b']);
    expect(seen).toEqual([
      '/v1/models?limit=1000',
      '/v1/models?limit=1000&after_id=a',
    ]);
  });

  test('report the service’s own error', async () => {
    const failing = listModels(
      provider(),
      fakeFetch({
        '/v1/models': json(
          { error: { message: 'Incorrect API key provided' } },
          401
        ),
      })
    );
    const error = await failing.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelListError);
    expect((error as ModelListError).status).toBe(401);
    expect((error as ModelListError).message).toContain(
      'Incorrect API key provided'
    );
  });
});

describe('checkProvider', () => {
  test('lists the models when the service can', async () => {
    const result = await checkProvider(
      provider(),
      fakeFetch({ '/v1/models': json({ data: [{ id: 'm' }] }) })
    );
    expect(result).toMatchObject({ kind: 'models', models: [{ id: 'm' }] });
  });

  test('asks the first model when the service lists none', async () => {
    const result = await checkProvider(
      provider({
        models: [guessCapabilities('local-model', { local: true })],
      }),
      fakeFetch({
        '/v1/chat/completions': json({
          id: 'c',
          object: 'chat.completion',
          created: 0,
          model: 'local-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'OK' },
              finish_reason: 'stop',
            },
          ],
        }),
      })
    );
    expect(result).toEqual({ kind: 'answered', model: 'local-model' });
  });

  test('passes on a refused key', async () => {
    await expect(
      checkProvider(
        provider({ models: [guessCapabilities('m', { local: false })] }),
        fakeFetch({ '/v1/models': json({ error: 'nope' }, 401) })
      )
    ).rejects.toMatchObject({ status: 401 });
  });
});

/** A chat completion streamed as `deltas` of its content. */
const streamed = (deltas: string[]) => () =>
  new Response(
    [
      ...deltas.map((content) => ({
        id: 'c',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })),
      {
        id: 'c',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .concat('data: [DONE]\n\n')
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );

describe('languageModel', () => {
  test("speaks DeepSeek's dialect of Chat Completions for DeepSeek", () => {
    const fetch = fakeFetch({});
    const deepseek = languageModel(
      provider({ preset: 'deepseek', baseUrl: 'https://api.deepseek.com' }),
      'deepseek-chat',
      fetch
    );
    expect(deepseek.provider).toStartWith('deepseek');
    expect(languageModel(provider(), 'm', fetch).provider).toStartWith(
      'compatible'
    );
  });

  test("reads a compatible model's thinking out of its reply", async () => {
    const model = languageModel(
      provider(),
      'm',
      fakeFetch({
        '/v1/chat/completions': streamed([
          '<thi',
          'nk>hm, a',
          '</think>',
          '\n\nHello.',
        ]),
      })
    );
    const result = streamText({ model, prompt: 'Hi' });
    expect(await result.text).toBe('\n\nHello.');
    expect(await result.reasoningText).toBe('hm, a');
  });
});
