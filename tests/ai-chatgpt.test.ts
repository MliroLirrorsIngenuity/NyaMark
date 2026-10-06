import { describe, expect, test } from 'bun:test';
import { APICallError, RetryError, jsonSchema, streamText, tool } from 'ai';
import { describeFailure } from '../src/ai/agent/session';
import {
  ReplyCutOffError,
  USAGE_LIMIT,
  planErrorCode,
  stopsPlan,
} from '../src/ai/providers/chatgpt';
import { languageModel } from '../src/ai/providers/factory';
import { listModels, parseChatGptModels } from '../src/ai/providers/models';
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
    expect(body).toMatchObject({ stream: true, store: false });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.input[0]).toMatchObject({ role: 'developer' });
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'nyamark',
        tools: [
          expect.objectContaining({ type: 'function', name: 'read_document' }),
        ],
      }),
    ]);
  });

  test('send earlier tool calls in the namespace', async () => {
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
    expect(bodies[0].input).toContainEqual(
      expect.objectContaining({
        type: 'function_call',
        call_id: 'call-1',
        namespace: 'nyamark',
      })
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
            error: { code: USAGE_LIMIT, message: 'Usage limit reached.' },
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
      message: `Usage limit reached. (${USAGE_LIMIT})`,
      status: 429,
    });
  });

  test('read the limit from a stream that sent nothing else', async () => {
    let calls = 0;
    const streamed = events([
      {
        type: 'error',
        sequence_number: 0,
        code: USAGE_LIMIT,
        message: 'Usage limit reached.',
      },
    ]);
    const { errors } = await reply(
      fakeFetch(() => {
        calls++;
        return streamed();
      })
    );
    expect(calls).toBe(1);
    expect(describeFailure(errors[0]).code).toBe('usage-limit');
  });
});

describe('plan errors', () => {
  const apiError = (code: string, status: number) =>
    new APICallError({
      message: 'refused',
      url: `${CHATGPT_BASE_URL}/responses`,
      requestBodyValues: {},
      statusCode: status,
      data: { error: { code } },
    });

  test('stop, or wait and pass, as OpenAI says', () => {
    expect(stopsPlan(apiError(USAGE_LIMIT, 429))).toBe(true);
    expect(
      stopsPlan(apiError('subscription_sharing_user_not_eligible', 403))
    ).toBe(true);
    expect(
      stopsPlan(apiError('subscription_sharing_usage_unavailable', 503))
    ).toBe(false);
    expect(
      stopsPlan(apiError('subscription_sharing_user_unavailable', 503))
    ).toBe(false);
    expect(stopsPlan(apiError('rate_limit_exceeded', 429))).toBe(false);
    const retried = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(USAGE_LIMIT, 429)],
    });
    expect(planErrorCode(retried)).toBe(USAGE_LIMIT);
  });

  test('read as what the user can do about them', () => {
    expect(
      describeFailure(apiError('subscription_sharing_user_not_eligible', 403))
        .code
    ).toBe('plan-unavailable');
    expect(
      describeFailure(apiError('subscription_sharing_invalid_user', 401)).code
    ).toBe('signed-out');
    expect(describeFailure(apiError('chatpass_v2_unknown', 400))).toEqual({
      code: 'other',
      message: 'refused (chatpass_v2_unknown)',
      status: 400,
    });
  });

  test('a sign-in the app could not use says so', () => {
    const failed = (failure: ConstructorParameters<typeof AiFetchError>[0]) =>
      describeFailure(new AiFetchError(failure));
    expect(failed({ kind: 'signed-out' }).code).toBe('signed-out');
    expect(failed({ kind: 'plan-disabled' }).code).toBe('plan-disabled');
    expect(
      failed({ kind: 'sign-in-failed', code: 'invalid_grant', message: null })
    ).toEqual({ code: 'renew-failed', message: 'invalid_grant' });
  });
});

describe('ChatGPT models', () => {
  test('keep the listed ones in the order given, with their names', () => {
    expect(
      parseChatGptModels({
        models: [
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
          { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
          { slug: 'gpt-5.5-mini', visibility: 'list' },
          { display_name: 'No slug', visibility: 'list' },
        ],
      })
    ).toEqual([
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.5-mini', name: undefined },
    ]);
    expect(parseChatGptModels({ data: [{ id: 'gpt-5' }] })).toEqual([]);
  });

  test('come from the plan’s own list', async () => {
    const seen: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          models: [
            { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }) as typeof globalThis.fetch;
    expect(await listModels(chatgpt, fetch)).toEqual([
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ]);
    expect(seen).toEqual([`${CHATGPT_BASE_URL}/models`]);
  });
});
