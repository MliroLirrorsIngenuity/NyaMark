import { describe, expect, test } from 'bun:test';
import { APICallError, RetryError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  type AssistantEntry,
  ChatFailureError,
  ChatSession,
  type SessionChange,
  describeFailure,
  replyText,
} from '../src/ai/agent/session';
import { AiFetchError } from '../src/bridge/ipc/ai';

type DoStream = MockLanguageModelV4['doStream'];
type StreamPart = Awaited<
  ReturnType<DoStream>
>['stream'] extends ReadableStream<infer Part>
  ? Part
  : never;

const usage = (input: number, output: number) => ({
  inputTokens: {
    total: input,
    noCache: input,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const finish = (input = 10, output = 5): StreamPart => ({
  type: 'finish',
  usage: usage(input, output),
  finishReason: { unified: 'stop', raw: 'stop' },
});

function textParts(...chunks: string[]): StreamPart[] {
  return [
    { type: 'text-start', id: 't' },
    ...chunks.map(
      (delta): StreamPart => ({ type: 'text-delta', id: 't', delta })
    ),
    { type: 'text-end', id: 't' },
  ];
}

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

/** A model whose replies are the given part lists, one per call. */
function scriptedModel(...replies: StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => streamOf(replies[call++] ?? [finish()]),
  });
}

/**
 * A model that says `Half` and then waits, until the request is aborted or
 * the test lets it finish.
 */
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
            controller.enqueue({ type: 'text-delta', id: 't', delta: ' done' });
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

function sessionWith(model: MockLanguageModelV4 | (() => MockLanguageModelV4)) {
  const changes: SessionChange[] = [];
  const session = new ChatSession(() => ({
    model: typeof model === 'function' ? model() : model,
    modelLabel: 'mock-model',
    instructions: 'Be brief.',
  }));
  session.subscribe((change) => changes.push(change));
  return { session, changes };
}

function lastReply(session: ChatSession): AssistantEntry {
  const entry = session.entries[session.entries.length - 1];
  if (entry?.role !== 'assistant') throw new Error('no reply');
  return entry;
}

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

const apiError = (statusCode: number | undefined, responseBody?: string) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://api.example.com/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: false,
  });

describe('a turn', () => {
  test('streams the reply and keeps it for the next turn', async () => {
    const model = scriptedModel([...textParts('Hel', 'lo'), finish(12, 3)]);
    const { session, changes } = sessionWith(model);

    await session.send('  Hi there  ');

    expect(session.busy).toBe(false);
    expect(session.entries).toHaveLength(2);
    expect(session.entries[0]).toMatchObject({
      role: 'user',
      text: 'Hi there',
    });
    const reply = lastReply(session);
    expect(reply).toMatchObject({
      status: 'done',
      model: 'mock-model',
      usage: { input: 12, output: 3 },
      historyStart: 1,
    });
    expect(replyText(reply)).toBe('Hello');
    expect(changes.filter((c) => c.kind === 'updated').length).toBeGreaterThan(
      1
    );

    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(session.messages[0]).toEqual({ role: 'user', content: 'Hi there' });
    const sent = model.doStreamCalls[0];
    expect(sent?.prompt[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  test('sends the earlier turns with the next message', async () => {
    const model = scriptedModel(
      [...textParts('One'), finish()],
      [...textParts('Two'), finish()]
    );
    const { session } = sessionWith(model);
    await session.send('first');
    await session.send('second');

    const prompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(session.messages).toHaveLength(4);
  });

  test('keeps reasoning apart from the reply', async () => {
    const model = scriptedModel([
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: 'Let me ' },
      { type: 'reasoning-delta', id: 'r', delta: 'think.' },
      { type: 'reasoning-end', id: 'r' },
      ...textParts('Answer'),
      finish(),
    ]);
    const { session } = sessionWith(model);
    await session.send('Why?');

    const reply = lastReply(session);
    expect(reply.parts).toEqual([
      { type: 'reasoning', text: 'Let me think.' },
      { type: 'text', text: 'Answer' },
    ]);
    expect(replyText(reply)).toBe('Answer');
  });

  test('ignores an empty message and one sent while busy', async () => {
    const { model, release } = stallingModel();
    const { session } = sessionWith(model);
    await session.send('   ');
    expect(session.entries).toHaveLength(0);

    const first = session.send('one');
    await firstText(session);
    await session.send('two');
    release();
    await first;
    expect(session.entries.map((e) => e.role)).toEqual(['user', 'assistant']);
  });
});

describe('stopping', () => {
  test('keeps what was said and lets the turn be asked again', async () => {
    const stalled = stallingModel();
    let calls = 0;
    const again = scriptedModel([...textParts('Whole'), finish()]);
    const { session } = sessionWith(() =>
      calls++ === 0 ? stalled.model : again
    );

    const turn = session.send('Write');
    await firstText(session);
    session.stop();
    await turn;

    const stopped = lastReply(session);
    expect(stopped.status).toBe('stopped');
    expect(stopped.error).toBeUndefined();
    expect(replyText(stopped)).toBe('Half');
    expect(session.busy).toBe(false);
    expect(session.messages).toEqual([
      { role: 'user', content: 'Write' },
      { role: 'assistant', content: 'Half' },
    ]);

    await session.retry();
    expect(session.entries).toHaveLength(2);
    const retried = lastReply(session);
    expect(retried.status).toBe('done');
    expect(replyText(retried)).toBe('Whole');
    // The stopped reply is no longer part of what the model was sent.
    const prompt = again.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual(['system', 'user']);
  });

  test('a finished reply is not asked again', async () => {
    const model = scriptedModel([...textParts('Done'), finish()]);
    const { session } = sessionWith(model);
    await session.send('Go');
    await session.retry();
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe('clearing', () => {
  test('drops the conversation and a reply on its way', async () => {
    const { model } = stallingModel();
    const { session, changes } = sessionWith(model);
    const turn = session.send('Write');
    await firstText(session);

    session.clear();
    const after = changes.length;
    await turn;

    expect(session.entries).toHaveLength(0);
    expect(session.messages).toHaveLength(0);
    expect(session.busy).toBe(false);
    expect(changes[after - 1]).toEqual({ kind: 'reset' });
    expect(changes.length).toBe(after);
  });
});

describe('failures', () => {
  test('a turn with no model asks for one', async () => {
    const session = new ChatSession(() => {
      throw new ChatFailureError({ code: 'no-model', message: '' });
    });
    await session.send('Hi');
    const reply = lastReply(session);
    expect(reply.status).toBe('error');
    expect(reply.error?.code).toBe('no-model');
    expect(session.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  test('a refused key reads as unauthorized, in the service’s words', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw apiError(401, '{"error":{"message":"Incorrect API key"}}');
      },
    });
    const { session } = sessionWith(model);
    await session.send('Hi');
    expect(lastReply(session).error).toEqual({
      code: 'unauthorized',
      message: 'Incorrect API key',
      status: 401,
    });
  });

  test('a failure part way keeps the text before it', async () => {
    const model = scriptedModel([
      ...textParts('Partial'),
      { type: 'error', error: apiError(500, 'upstream exploded') },
    ]);
    const { session } = sessionWith(model);
    await session.send('Hi');
    const reply = lastReply(session);
    expect(reply.status).toBe('error');
    expect(reply.error).toMatchObject({ code: 'other', status: 500 });
    expect(replyText(reply)).toBe('Partial');
  });
});

describe('describeFailure', () => {
  test('sorts service errors by status', () => {
    expect(describeFailure(apiError(403)).code).toBe('unauthorized');
    expect(describeFailure(apiError(429)).code).toBe('rate-limited');
    expect(describeFailure(apiError(undefined)).code).toBe('network');
    expect(describeFailure(apiError(502))).toEqual({
      code: 'other',
      message: 'HTTP 502',
      status: 502,
    });
  });

  test('reads the message from the body in its common shapes', () => {
    expect(
      describeFailure(apiError(400, '{"message":"Bad model"}')).message
    ).toBe('Bad model');
    expect(describeFailure(apiError(400, '{"error":"Nope"}')).message).toBe(
      'Nope'
    );
    expect(describeFailure(apiError(400, 'Plain refusal')).message).toBe(
      'Plain refusal'
    );
    expect(
      describeFailure(apiError(400, `<html>${'x'.repeat(400)}`)).message
    ).toBe('HTTP 400');
  });

  test('looks through retries to the last error', () => {
    const error = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(500), apiError(429)],
    });
    expect(describeFailure(error)).toMatchObject({
      code: 'rate-limited',
      status: 429,
    });
  });

  test('knows the app’s own refusals', () => {
    expect(
      describeFailure(new AiFetchError({ kind: 'not-connected' })).code
    ).toBe('not-connected');
    expect(describeFailure(new AiFetchError({ kind: 'key-needed' })).code).toBe(
      'key-needed'
    );
    const reset = new AiFetchError({ kind: 'network', message: 'reset' });
    expect(
      describeFailure(new TypeError('fetch failed', { cause: reset })).code
    ).toBe('network');
    expect(describeFailure(new TypeError('x is not a function')).code).toBe(
      'other'
    );
    expect(describeFailure('key-needed').code).toBe('other');
  });
});
