import { describe, expect, test } from 'bun:test';
import { streamText } from 'ai';
import { defaultEffort, effortLevels } from '../src/ai/providers/effort';
import { languageModel } from '../src/ai/providers/factory';
import { parseChatGptModels } from '../src/ai/providers/models';
import {
  AI_EFFORTS,
  type AiEffort,
  type AiModelInfo,
  type AiProvider,
  CHATGPT_BASE_URL,
} from '../src/state/ai-settings';
import { normalizeSettings } from '../src/state/settings';
import { followListing } from '../src/ui/settings-panel/sections/ai-models';

function model(overrides: Partial<AiModelInfo> = {}): AiModelInfo {
  return {
    id: 'm',
    vision: false,
    tools: true,
    reasoning: true,
    contextWindow: 128_000,
    ...overrides,
  };
}

function provider(
  overrides: Partial<AiProvider> = {},
  effort?: AiEffort
): AiProvider {
  return {
    id: 'p-test',
    name: 'Test',
    preset: 'custom',
    kind: 'openai-compatible',
    auth: 'key',
    baseUrl: 'https://api.example.com/v1',
    models: [model({ effort })],
    ...overrides,
  };
}

type Body = Record<string, unknown>;

/** The body of the first request a reply sends; the service turns it down. */
async function sent(service: AiProvider, modelId = 'm'): Promise<Body> {
  const bodies: Body[] = [];
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    return new Response('{"error":{"message":"Stopped here."}}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const result = streamText({
    model: languageModel(service, modelId, fetch),
    prompt: 'Hi',
    maxRetries: 0,
    onError: () => {},
  });
  await result.consumeStream();
  return bodies[0] ?? {};
}

describe('effort levels', () => {
  test('come from the service when it lists them', () => {
    const listed = model({ efforts: ['low', 'xhigh', 'max'] });
    expect(effortLevels(provider({ kind: 'openai' }), listed)).toEqual([
      'low',
      'xhigh',
      'max',
    ]);
  });

  test('else are those the API takes', () => {
    const levels = (overrides: Partial<AiProvider>) =>
      effortLevels(provider(overrides), model());
    expect(levels({ kind: 'openai' })).toEqual([...AI_EFFORTS]);
    expect(levels({})).toEqual(['low', 'medium', 'high']);
    expect(levels({ preset: 'deepseek' })).toEqual(['none', 'high', 'xhigh']);
    expect(levels({ kind: 'anthropic' })).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(levels({ kind: 'google' })).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ]);
  });

  test('for a ChatGPT model saved without them are those Codex lists', () => {
    const chatgpt = provider({ kind: 'openai', auth: 'chatgpt' });
    const saved = model({ id: 'gpt-6-luna' });
    expect(effortLevels(chatgpt, saved)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(defaultEffort(chatgpt, saved)).toBe('medium');
    expect(effortLevels(chatgpt, model({ id: 'gpt-5.5' }))).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  test('are none for a model that does not reason', () => {
    expect(effortLevels(provider(), model({ reasoning: false }))).toEqual([]);
  });
});

describe('the level chosen', () => {
  test('goes with each request to a Chat Completions service', async () => {
    expect((await sent(provider({}, 'high'))).reasoning_effort).toBe('high');
  });

  test('is left to the service when none is chosen', async () => {
    expect(await sent(provider())).not.toHaveProperty('reasoning_effort');
  });

  test('is left to the service when the model does not take it', async () => {
    expect(await sent(provider({}, 'max'))).not.toHaveProperty(
      'reasoning_effort'
    );
    const plain = provider({
      models: [model({ reasoning: false, effort: 'high' })],
    });
    expect(await sent(plain)).not.toHaveProperty('reasoning_effort');
  });

  test('goes by its own name to the Responses API', async () => {
    const openai = provider({
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [model({ id: 'gpt-5.5', effort: 'high' })],
    });
    expect((await sent(openai, 'gpt-5.5')).reasoning).toMatchObject({
      effort: 'high',
    });
  });

  test('reaches a ChatGPT plan, `max` too', async () => {
    const chatgpt = provider({
      kind: 'openai',
      auth: 'chatgpt',
      preset: 'chatgpt',
      baseUrl: CHATGPT_BASE_URL,
      models: [
        model({
          id: 'gpt-5.6-sol',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          effort: 'max',
        }),
      ],
    });
    const body = await sent(chatgpt, 'gpt-5.6-sol');
    expect(body.reasoning).toMatchObject({ effort: 'max' });
    expect(body.store).toBe(false);
  });

  test('turns thinking off for Claude and DeepSeek', async () => {
    const claude = provider(
      { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
      'none'
    );
    expect((await sent(claude)).thinking).toEqual({ type: 'disabled' });
    const deepseek = provider(
      { preset: 'deepseek', baseUrl: 'https://api.deepseek.com' },
      'none'
    );
    expect((await sent(deepseek)).thinking).toEqual({ type: 'disabled' });
  });

  test('sets how much Gemini thinks', async () => {
    const gemini = provider(
      {
        kind: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      },
      'none'
    );
    const body = await sent(gemini);
    expect(body.generationConfig).toMatchObject({
      thinkingConfig: { thinkingBudget: 0 },
    });
  });
});

describe('ChatGPT effort levels', () => {
  test('are read from Codex’s list, without those the app has no name for', () => {
    const [listed] = parseChatGptModels({
      models: [
        {
          slug: 'gpt-6-sol',
          visibility: 'list',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low', description: 'Fast' },
            { effort: 'max', description: 'Deep' },
            { effort: 'ultra', description: 'Delegates' },
          ],
        },
      ],
    });
    expect(listed).toMatchObject({
      efforts: ['low', 'max'],
      defaultEffort: 'medium',
    });
  });

  test('follow the list when it is fetched again, keeping the level chosen', () => {
    const on = model({ efforts: ['low', 'high'], effort: 'high' });
    const listed = { id: 'm', efforts: ['low', 'high', 'max'] as AiEffort[] };
    expect(followListing(on, listed)).toBe(true);
    expect(on).toMatchObject({
      efforts: ['low', 'high', 'max'],
      effort: 'high',
    });
    expect(followListing(on, listed)).toBe(false);
  });

  test('are left out when Codex lists none', () => {
    const [listed] = parseChatGptModels({
      models: [{ slug: 'gpt-x', visibility: 'list' }],
    });
    expect(listed?.efforts).toBeUndefined();
    expect(listed?.defaultEffort).toBeUndefined();
  });
});

describe('saved effort', () => {
  test('keeps known levels, in order, and drops the rest', () => {
    const { ai } = normalizeSettings({
      ai: {
        providers: [
          {
            id: 'p-1',
            kind: 'openai',
            models: [
              {
                id: 'a',
                reasoning: true,
                efforts: ['max', 'low', 'ultra', 'low'],
                defaultEffort: 'medium',
                effort: 'max',
              },
              { id: 'b', efforts: 'high', defaultEffort: 'x', effort: 7 },
            ],
          },
        ],
      },
    } as never);
    const [a, b] = ai.providers[0]?.models ?? [];
    expect(a).toMatchObject({
      efforts: ['low', 'max'],
      defaultEffort: 'medium',
      effort: 'max',
    });
    expect(b).not.toHaveProperty('efforts');
    expect(b).not.toHaveProperty('defaultEffort');
    expect(b).not.toHaveProperty('effort');
  });
});
