/**
 * Requests paid for with the user's ChatGPT plan. OpenAI takes a narrower
 * Responses API on this route (its "Preview limitations" for Sign in with
 * ChatGPT): every request streams and stores nothing, the system prompt
 * goes as developer messages, sampling settings and output caps are
 * refused, and function tools are sent in a namespace.
 */

import {
  APICallError,
  type JSONValue,
  type LanguageModelMiddleware,
  RetryError,
  StreamProviderError,
} from 'ai';

/** Where the user reviews and limits what NyaMark uses of their plan. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** The namespace the app's tools go in. */
const TOOLS = {
  name: 'nyamark',
  description:
    'Tools of NyaMark, the Markdown editor the user writes in: read and edit their notes, search the web, and the tools of the MCP servers they connected.',
};

/** The plan's limit for NyaMark or for the account is reached. */
export const USAGE_LIMIT = 'subscription_sharing_usage_limit_exceeded';

/**
 * Plan errors OpenAI says to retry later, with backoff. Every other one
 * stops: sent again as it is, it fails again.
 */
const PASSING = new Set([
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_unavailable',
]);

/** The code of an error that comes from the ChatGPT plan, as OpenAI typed it. */
export function planErrorCode(error: unknown): string | null {
  if (RetryError.isInstance(error)) return planErrorCode(error.lastError);
  let code: unknown;
  if (StreamProviderError.isInstance(error)) code = error.code;
  else if (APICallError.isInstance(error)) {
    // An error answer, or the error event of a stream that sent no output.
    const data = error.data as
      | {
          code?: unknown;
          error?: { code?: unknown };
          response?: { error?: { code?: unknown } };
        }
      | undefined;
    code = data?.error?.code ?? data?.response?.error?.code ?? data?.code;
  }
  return typeof code === 'string' &&
    (code.startsWith('subscription_sharing_') || code.startsWith('chatpass_'))
    ? code
    : null;
}

/** Whether the plan said to stop asking, rather than to wait and ask again. */
export function stopsPlan(error: unknown): boolean {
  const code = planErrorCode(error);
  return code !== null && !PASSING.has(code);
}

/** A reply that ended before OpenAI said it was complete. */
export class ReplyCutOffError extends Error {
  constructor() {
    super('The reply broke off before ChatGPT finished it.');
  }
}

type CallOptions = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params'];
type Prompt = CallOptions['prompt'];
type ProviderOptions = CallOptions['providerOptions'];
type Started = Awaited<
  ReturnType<
    Parameters<
      NonNullable<LanguageModelMiddleware['wrapStream']>
    >[0]['doStream']
  >
>;
type StreamPart = Started['stream'] extends ReadableStream<infer Part>
  ? Part
  : never;

/** Events that end a response: anything else ends it short. */
const ENDINGS = new Set(['response.completed', 'response.incomplete']);

function withOpenAi(
  options: ProviderOptions,
  extra: Record<string, JSONValue>
): NonNullable<ProviderOptions> {
  return { ...options, openai: { ...options?.openai, ...extra } };
}

/**
 * Tool calls made before, in this conversation or by another service,
 * named as the namespace has them now.
 */
function namespaced(prompt: Prompt): Prompt {
  return prompt.map((message) =>
    message.role === 'assistant'
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === 'tool-call' &&
            !part.providerExecuted &&
            part.providerOptions?.openai?.namespace == null
              ? {
                  ...part,
                  providerOptions: withOpenAi(part.providerOptions, {
                    namespace: TOOLS.name,
                  }),
                }
              : part
          ),
        }
      : message
  );
}

function planParams(params: CallOptions): CallOptions {
  return {
    ...params,
    prompt: namespaced(params.prompt),
    temperature: undefined,
    topP: undefined,
    maxOutputTokens: undefined,
    // Read for the event that ends the response; see `wrapStream`.
    includeRawChunks: true,
    tools: params.tools?.map((tool) =>
      tool.type === 'function'
        ? {
            ...tool,
            providerOptions: withOpenAi(tool.providerOptions, {
              namespace: TOOLS,
            }),
          }
        : tool
    ),
    providerOptions: withOpenAi(params.providerOptions, {
      store: false,
      systemMessageMode: 'developer',
    }),
  };
}

/** `error`, not to be retried when the plan said so. */
function settled(error: unknown): unknown {
  if (!stopsPlan(error) || !APICallError.isInstance(error)) return error;
  return new APICallError({
    message: error.message,
    url: error.url,
    requestBodyValues: error.requestBodyValues,
    statusCode: error.statusCode,
    responseHeaders: error.responseHeaders,
    responseBody: error.responseBody,
    cause: error.cause,
    isRetryable: false,
    data: error.data,
  });
}

export const chatGptPlanMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => planParams(params),
  wrapStream: async ({ doStream }) => {
    let started: Started;
    try {
      started = await doStream();
    } catch (error) {
      throw settled(error);
    }
    const { stream, ...rest } = started;
    // A reply counts once OpenAI ends the response; a stream that closes
    // before then lost the rest of it.
    let ended = false;
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (part.type === 'raw') {
              const event = part.rawValue as { type?: unknown } | null;
              if (typeof event?.type === 'string' && ENDINGS.has(event.type)) {
                ended = true;
              }
              return;
            }
            if (part.type === 'error') ended = true;
            controller.enqueue(part);
          },
          flush(controller) {
            if (!ended) {
              controller.enqueue({
                type: 'error',
                error: new ReplyCutOffError(),
              });
            }
          },
        })
      ),
    };
  },
};
