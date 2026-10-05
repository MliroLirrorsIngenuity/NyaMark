/**
 * A `fetch` for the AI SDK's providers that sends through the app.
 *
 * The page may not reach the network (its content security policy allows
 * IPC only) and holds no keys: the request goes to the native side as
 * built, with a stand-in for the key, and the native side puts the saved
 * key in for the profile's own address. The answer streams back in chunks,
 * which this turns into the `Response` the SDK reads as it would from the
 * network.
 */

import type {
  AiFetchEvent,
  AiFetchHead,
  AiFetchRequest,
  ProxySetting,
} from '../../bridge/ipc/ai';

/** The native calls, passed in so tests can stand in for them. */
export type AiFetchBridge = {
  fetch(
    request: AiFetchRequest,
    onEvent: (event: AiFetchEvent) => void
  ): Promise<AiFetchHead>;
  abort(id: string): Promise<void>;
};

/** Statuses a `Response` may not have a body with. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function abortError() {
  return new DOMException('The request was stopped.', 'AbortError');
}

async function bodyText(body: BodyInit | null | undefined) {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return await new Response(body).text();
}

export function createRustFetch(
  bridge: AiFetchBridge,
  profile: string,
  proxy: () => ProxySetting
): typeof fetch {
  const rustFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError();

    const id = crypto.randomUUID();
    const requestBody = await bodyText(init?.body);
    if (signal?.aborted) throw abortError();
    const headers: [string, string][] = [];
    new Headers(init?.headers).forEach((value, name) => {
      headers.push([name, value]);
    });

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let settled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        // The reader gave up on the rest: the request need not go on.
        if (!settled) {
          settled = true;
          void bridge.abort(id).catch(() => {});
        }
      },
    });

    const onEvent = (event: AiFetchEvent) => {
      if (settled) return;
      if (event.type === 'chunk') {
        controller.enqueue(encoder.encode(event.text));
      } else if (event.type === 'end') {
        settled = true;
        controller.close();
      } else {
        settled = true;
        controller.error(new TypeError(event.message));
      }
    };

    let rejectHead: ((reason: unknown) => void) | null = null;
    const onAbort = () => {
      void bridge.abort(id).catch(() => {});
      rejectHead?.(abortError());
      if (!settled) {
        settled = true;
        controller.error(abortError());
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let head: AiFetchHead;
    try {
      head = await new Promise<AiFetchHead>((resolve, reject) => {
        rejectHead = reject;
        bridge
          .fetch(
            {
              id,
              profile,
              url,
              method: init?.method ?? 'GET',
              headers,
              body: requestBody,
              proxy: proxy(),
            },
            onEvent
          )
          .then(resolve, (error) => reject(new TypeError(String(error))));
      });
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      settled = true;
      throw error;
    } finally {
      rejectHead = null;
    }

    const responseHeaders = new Headers();
    for (const [name, value] of head.headers) {
      responseHeaders.append(name, value);
    }
    return new Response(NULL_BODY_STATUSES.has(head.status) ? null : body, {
      status: head.status,
      headers: responseHeaders,
    });
  };
  return rustFetch as typeof fetch;
}
