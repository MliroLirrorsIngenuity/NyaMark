import { describe, expect, test } from 'bun:test';
import { APICallError, RetryError, jsonSchema, streamText, tool } from 'ai';
import { describeFailure } from '../src/ai/agent/session';
import {
  CODEX_MODELS,
  CODEX_VERSION,
  NOT_INCLUDED,
  ReplyCutOffError,
  USAGE_LIMIT,
  planErrorCode,
  stopsPlan,
} from '../src/ai/providers/chatgpt';
import { languageModel } from '../src/ai/providers/factory';
import {
  ModelListError,
  listModels,
  parseChatGptModels,
} from '../src/ai/providers/models';
import { AiFetchError } from '../src/bridge/ipc/ai';
import { type AiProvider, CHATGPT_BASE_URL } from '../src/state/ai-settings';

const chatgpt: AiProvider = {
  id: 'p-chatgpt',
  name: 'ChatGPT',
  preset: 'chatgpt',
  kind: 'openai',
  auth: 'chatgpt',
  baseUrl: CHATGPT_BASE_URL,
  models: [],
};

type Body = Record<string, unknown> & { input: unknown[]; tools?: unknown[] };

/** Answers every request with `answer`, keeping the bodies sent. */
function fakeFetch(answer: () => Response, bodies: Body[] = []): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    return answer();
  }) as typeof fetch;
}

const events = (list: object[]) => () =>
  new Response(
    list.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    }
  );

const started = [
  {
    type: 'response.created',
    response: { id: 'r-1', created_at: 0, model: 'gpt-5.5' },
  },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message', id: 'm-1' },
  },
  {
    type: 'response.output_text.delta',
    item_id: 'm-1',
    output_index: 0,
    delta: 'Hello.',
  },
];

const completed = {
  type: 'response.completed',
  response: { usage: { input_tokens: 3, output_tokens: 2 } },
};

/** The errors a reply streamed, and its text. */
async function reply(fetch: typeof globalThis.fetch) {
  const result = streamText({
    model: languageModel(chatgpt, 'gpt-5.5', fetch),
    prompt: 'Hi',
    maxRetries: 2,
    // Read below, from the stream.
    onError: () => {},
  });
  const errors: unknown[] = [];
  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'error') errors.push(part.error);
    if (part.type === 'text-delta') text += part.text;
  }
  return { errors, text };
}

describe('requests on a ChatGPT plan', () => {
  test('stream, store nothing, and leave out what the plan refuses', async () => {
    const bodies: Body[] = [];
    const result = streamText({
      model: languageModel(
        chatgpt,
        'gpt-5.5',
        fakeFetch(events([...started, completed]), bodies)
      ),
      system: 'Be brief.',
      prompt: 'Hi',
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 100,
      tools: {
        read_document: tool({
          description: 'Reads the document.',
          inputSchema: jsonSchema({ type: 'object', properties: {} }),
        }),
      },
    });
    expect(await result.text).toBe('Hello.');
    const [body] = bodies;
    expect(body).toMatchObject({
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    expect(body.instructions).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.input[0]).toMatchObject({ role: 'developer' });
    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'read_document' }),
    ]);
  });

  test('send earlier reasoning and tool calls back whole', async () => {
    const bodies: Body[] = [];
    const result = streamText({
      model: languageModel(
        chatgpt,
        'gpt-5.5',
        fakeFetch(events([...started, completed]), bodies)
      ),
      messages: [
        { role: 'user', content: 'Read it.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: '',
              providerOptions: {
                openai: { itemId: 'rs-1', reasoningEncryptedContent: 'sealed' },
              },
            },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'read_document',
              input: {},
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'read_document',
              output: { type: 'text', value: '# Notes' },
            },
          ],
        },
      ],
    });
    await result.text;
    const { input } = bodies[0];
    expect(input).toContainEqual({
      type: 'reasoning',
      id: 'rs-1',
      encrypted_content: 'sealed',
      summary: [],
    });
    const call = input.find(
      (item) => (item as { type?: string }).type === 'function_call'
    );
    expect(call).toMatchObject({ call_id: 'call-1', name: 'read_document' });
    expect(call).not.toHaveProperty('namespace');
    expect(input).not.toContainEqual(
      expect.objectContaining({ type: 'item_reference' })
    );
  });

  test('count a reply only once OpenAI completes it', async () => {
    const whole = await reply(fakeFetch(events([...started, completed])));
    expect(whole).toEqual({ errors: [], text: 'Hello.' });

    const cut = await reply(fakeFetch(events(started)));
    expect(cut.text).toBe('Hello.');
    expect(cut.errors).toHaveLength(1);
    expect(cut.errors[0]).toBeInstanceOf(ReplyCutOffError);
    expect(describeFailure(cut.errors[0]).code).toBe('network');
  });

  test('stop at the usage limit without asking again', async () => {
    const answered = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              type: USAGE_LIMIT,
              message: 'The usage limit has been reached',
              plan_type: 'plus',
              resets_at: 1_790_000_000,
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } }
        )
    );
    let calls = 0;
    const counted: typeof fetch = (async (
      ...args: Parameters<typeof fetch>
    ) => {
      calls++;
      return answered(...args);
    }) as typeof fetch;
    const { errors } = await reply(counted);
    expect(calls).toBe(1);
    expect(planErrorCode(errors[0])).toBe(USAGE_LIMIT);
    expect(describeFailure(errors[0])).toEqual({
      code: 'usage-limit',
      message: `The usage limit has been reached (${USAGE_LIMIT})`,
      status: 429,
    });
  });

  test('read a refusal from a stream that sent nothing else', async () => {
    let calls = 0;
    // In a stream, Codex reads the error's code.
    const streamed = events([
      {
        type: 'response.failed',
        sequence_number: 0,
        response: {
          id: 'r-1',
          error: {
            code: NOT_INCLUDED,
            message: 'Your plan does not include Codex.',
          },
        },
      },
    ]);
    const { errors } = await reply(
      fakeFetch(() => {
        calls++;
        return streamed();
      })
    );
    expect(calls).toBe(1);
    expect(describeFailure(errors[0]).code).toBe('plan-unavailable');
  });
});

describe('plan errors', () => {
  const apiError = (fields: object, status: number) =>
    new APICallError({
      message: 'refused',
      url: `${CHATGPT_BASE_URL}/responses`,
      requestBodyValues: {},
      statusCode: status,
      data: { error: fields },
    });

  test('stop where Codex stops, and pass the rest to retry', () => {
    expect(stopsPlan(apiError({ type: USAGE_LIMIT }, 429))).toBe(true);
    expect(stopsPlan(apiError({ type: NOT_INCLUDED }, 403))).toBe(true);
    expect(stopsPlan(apiError({ code: 'insufficient_quota' }, 429))).toBe(true);
    expect(stopsPlan(apiError({ type: 'server_is_overloaded' }, 503))).toBe(
      false
    );
    expect(stopsPlan(apiError({ code: 'rate_limit_exceeded' }, 429))).toBe(
      false
    );
    const retried = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError({ type: USAGE_LIMIT }, 429)],
    });
    expect(planErrorCode(retried)).toBe(USAGE_LIMIT);
  });

  test('read as what the user can do about them', () => {
    expect(describeFailure(apiError({ type: NOT_INCLUDED }, 403))).toEqual({
      code: 'plan-unavailable',
      message: `refused (${NOT_INCLUDED})`,
      status: 403,
    });
    expect(
      describeFailure(apiError({ code: 'credit_balance_exhausted' }, 429)).code
    ).toBe('usage-limit');
    expect(describeFailure(apiError({ type: 'invalid_request' }, 400))).toEqual(
      { code: 'other', message: 'refused', status: 400 }
    );
  });

  test('a sign-in the app could not use says so', () => {
    const failed = (failure: ConstructorParameters<typeof AiFetchError>[0]) =>
      describeFailure(new AiFetchError(failure));
    expect(failed({ kind: 'signed-out' }).code).toBe('signed-out');
    expect(
      failed({ kind: 'sign-in-failed', code: 'invalid_grant', message: null })
    ).toEqual({ code: 'renew-failed', message: 'invalid_grant' });
  });
});

describe('ChatGPT models', () => {
  test('keep the listed ones by priority, with what Codex says of them', () => {
    expect(
      parseChatGptModels({
        models: [
          {
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            visibility: 'list',
            priority: 13,
            context_window: 272000,
            input_modalities: ['text', 'image'],
          },
          { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
          { slug: 'gpt-6-sol', visibility: 'list', priority: 3 },
          { display_name: 'No slug', visibility: 'list' },
        ],
      })
    ).toEqual([
      {
        id: 'gpt-6-sol',
        name: undefined,
        contextWindow: undefined,
        vision: undefined,
        tools: true,
        reasoning: true,
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        contextWindow: 272000,
        vision: true,
        tools: true,
        reasoning: true,
      },
    ]);
    expect(parseChatGptModels({ data: [{ id: 'gpt-5' }] })).toEqual([]);
  });

  /** Answers the model list with `status` and `body`, keeping the addresses. */
  const answering = (status: number, body: object, seen: string[]) =>
    (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

  test('come from Codex’s list for the account', async () => {
    const seen: string[] = [];
    const fetch = answering(
      200,
      {
        models: [
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
        ],
      },
      seen
    );
    expect(await listModels(chatgpt, fetch)).toMatchObject([
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ]);
    expect(seen).toEqual([
      `${CHATGPT_BASE_URL}/models?client_version=${CODEX_VERSION}`,
    ]);
  });

  test('fall back to the ones Codex ships with, unless signed out', async () => {
    const error = { detail: 'unavailable' };
    expect(await listModels(chatgpt, answering(503, error, []))).toEqual(
      CODEX_MODELS
    );
    expect(CODEX_MODELS[0]).toMatchObject({ id: 'gpt-6.1-sol', vision: true });
    await expect(
      listModels(chatgpt, answering(401, error, []))
    ).rejects.toBeInstanceOf(ModelListError);
  });
});
