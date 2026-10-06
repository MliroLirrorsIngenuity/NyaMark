import { describe, expect, test } from 'bun:test';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateText } from 'ai';
import { describeFailure } from '../src/ai/agent/session';
import { type AiFetchBridge, createRustFetch } from '../src/ai/transport/fetch';
import {
  AiFetchError,
  type AiFetchEvent,
  type AiFetchHead,
  type AiFetchRequest,
  type FetchFailure,
} from '../src/bridge/ipc/ai';

type Call = {
  request: AiFetchRequest;
  emit: (event: AiFetchEvent) => void;
  respond: (head: AiFetchHead) => void;
  fail: (failure: FetchFailure) => void;
};

/** A native side the test answers by hand. */
function fakeBridge() {
  const calls: Call[] = [];
  const aborted: string[] = [];
  const bridge: AiFetchBridge = {
    fetch(request, onEvent) {
      return new Promise((resolve, reject) => {
        calls.push({
          request,
          emit: onEvent,
          respond: resolve,
          fail: (failure) => reject(new AiFetchError(failure)),
        });
      });
    },
    async abort(id) {
      aborted.push(id);
    },
  };
  return { bridge, calls, aborted };
}

const ok = (headers: [string, string][] = []): AiFetchHead => ({
  status: 200,
  headers,
});

/** Lets the fetch reach the bridge. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRustFetch', () => {
  test('hands the request over as the SDK built it', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'openai-1', () => ({
      mode: 'manual',
      url: 'http://127.0.0.1:7890',
    }));
    const pending = fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer nyamark',
        'Content-Type': 'application/json',
      },
      body: '{"stream":true}',
    });
    await tick();
    const [call] = calls;
    expect(call?.request).toMatchObject({
      profile: 'openai-1',
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      body: '{"stream":true}',
      proxy: { mode: 'manual', url: 'http://127.0.0.1:7890' },
    });
    expect(call?.request.headers).toContainEqual([
      'authorization',
      'Bearer nyamark',
    ]);
    expect(call?.request.headers).toContainEqual([
      'content-type',
      'application/json',
    ]);
    call?.respond(ok());
    call?.emit({ type: 'end' });
    expect((await pending).status).toBe(200);
  });

  test('streams the body, chunks sent before the head included', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch(new URL('https://a.example/x'));
    await tick();
    const call = calls[0];
    call?.emit({ type: 'chunk', text: 'data: 猫' });
    call?.respond(ok([['content-type', 'text/event-stream']]));
    const response = await pending;
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    call?.emit({ type: 'chunk', text: '\n\ndata: ニャー\n\n' });
    call?.emit({ type: 'end' });
    expect(await response.text()).toBe('data: 猫\n\ndata: ニャー\n\n');
    expect(call?.request.method).toBe('GET');
    expect(call?.request.body).toBeNull();
  });

  test('turns a byte body into text', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    void fetch('https://a.example/x', {
      method: 'POST',
      body: new TextEncoder().encode('{"a":"б"}'),
    });
    await tick();
    expect(calls[0]?.request.body).toBe('{"a":"б"}');
  });

  test('fails like fetch when the request cannot be sent', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch('https://a.example/x');
    await tick();
    calls[0]?.fail({ kind: 'network', message: 'connection refused' });
    const error = await pending.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ message: 'fetch failed' });
    expect((error as TypeError).cause).toBeInstanceOf(AiFetchError);
    expect((error as TypeError).cause).toMatchObject({
      failure: { kind: 'network', message: 'connection refused' },
    });
  });

  test('a request the app refused fails as itself', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch('https://a.example/x');
    await tick();
    calls[0]?.fail({ kind: 'key-needed' });
    const error = await pending.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AiFetchError);
    expect(error).toMatchObject({ failure: { kind: 'key-needed' } });
  });

  test('a body that breaks off fails its reader', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch('https://a.example/x');
    await tick();
    calls[0]?.respond(ok());
    const response = await pending;
    calls[0]?.emit({ type: 'chunk', text: 'part' });
    calls[0]?.emit({
      type: 'error',
      failure: { kind: 'network', message: 'connection reset' },
    });
    const error = await response.text().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).cause).toMatchObject({
      failure: { kind: 'network', message: 'connection reset' },
    });
  });

  test('stopping before the answer rejects and stops the native request', async () => {
    const { bridge, calls, aborted } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const controller = new AbortController();
    const pending = fetch('https://a.example/x', {
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toEqual([calls[0]?.request.id ?? '-']);
  });

  test('stopping while the body streams fails the reader', async () => {
    const { bridge, calls, aborted } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const controller = new AbortController();
    const pending = fetch('https://a.example/x', {
      signal: controller.signal,
    });
    await tick();
    calls[0]?.respond(ok());
    const response = await pending;
    calls[0]?.emit({ type: 'chunk', text: 'part' });
    controller.abort();
    expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toHaveLength(1);
    // What still arrives is dropped.
    calls[0]?.emit({ type: 'chunk', text: 'late' });
  });

  test('a signal stopped already sends nothing', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const controller = new AbortController();
    controller.abort();
    expect(
      fetch('https://a.example/x', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    expect(calls).toHaveLength(0);
  });

  test('a reader that gives up stops the native request', async () => {
    const { bridge, calls, aborted } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch('https://a.example/x');
    await tick();
    calls[0]?.respond(ok());
    const response = await pending;
    await response.body?.cancel();
    expect(aborted).toEqual([calls[0]?.request.id ?? '-']);
  });

  test('a status that has no body gets none', async () => {
    const { bridge, calls } = fakeBridge();
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const pending = fetch('https://a.example/x', { method: 'DELETE' });
    await tick();
    calls[0]?.respond({ status: 204, headers: [] });
    const response = await pending;
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});

describe('the SDK reading what the app fetch failed with', () => {
  /** Asks a model whose every request fails with `failure`. */
  const ask = (failure: FetchFailure) => {
    const bridge: AiFetchBridge = {
      fetch: () => Promise.reject(new AiFetchError(failure)),
      abort: async () => {},
    };
    const fetch = createRustFetch(bridge, 'p', () => ({ mode: 'system' }));
    const model = createOpenAICompatible({
      name: 'test',
      baseURL: 'https://a.example/v1',
      apiKey: 'nyamark-key',
      fetch,
    }).chatModel('m');
    return generateText({ model, prompt: 'Hi', maxRetries: 0 }).then(
      () => null,
      (error: unknown) => error
    );
  };

  test('a connection that failed is one it may retry', async () => {
    const error = await ask({ kind: 'network', message: 'connection refused' });
    expect(APICallError.isInstance(error)).toBe(true);
    expect((error as APICallError).isRetryable).toBe(true);
    expect(describeFailure(error).code).toBe('network');
  });

  test('a request the app refused is not retried and says why', async () => {
    const error = await ask({ kind: 'not-connected' });
    expect(APICallError.isInstance(error)).toBe(false);
    expect(describeFailure(error).code).toBe('not-connected');
  });
});
