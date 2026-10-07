/**
 * Requests paid for with the user's ChatGPT plan, sent to OpenAI's Codex
 * backend as the Codex CLI sends them. It takes a narrower Responses API:
 * every request streams and stores nothing, so reasoning goes back to it
 * encrypted; the system prompt goes as developer messages; and sampling
 * settings and output caps are refused.
 */

import {
  APICallError,
  type JSONValue,
  type LanguageModelMiddleware,
  RetryError,
  StreamProviderError,
} from 'ai';
import type { AiEffort } from '../../state/ai-settings';

/** Where the user sees what their plan has left. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** The Codex release whose requests NyaMark's follow. */
export const CODEX_VERSION = '0.160.1';

/** The levels Codex lists for most of its models, `ultra` left out. */
const LOW_TO_MAX: AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The models that release ships with, for when OpenAI cannot list them: the
 * ones it shows, by priority, with the levels of thought and the default it
 * lists for each.
 */
export const CODEX_MODELS = (
  [
    ['gpt-6.1-sol', 'GPT-6.1-Sol', 'low'],
    ['gpt-6-astra', 'GPT-6-Astra', 'low'],
    ['gpt-6-sol', 'GPT-6-Sol', 'medium'],
    ['gpt-6-luna', 'GPT-6-Luna', 'medium'],
    ['gpt-5.6-sol', 'GPT-5.6-Sol', 'low'],
    ['gpt-5.6-terra', 'GPT-5.6-Terra', 'medium'],
    ['gpt-5.6-luna', 'GPT-5.6-Luna', 'medium'],
    ['gpt-5.5', 'GPT-5.5', 'medium', ['low', 'medium', 'high', 'xhigh']],
  ] satisfies [string, string, AiEffort, AiEffort[]?][]
).map(([id, name, defaultEffort, efforts = LOW_TO_MAX]) => ({
  id,
  name,
  contextWindow: 272_000,
  vision: true,
  tools: true,
  reasoning: true,
  efforts,
  defaultEffort,
}));

/** The plan's usage limit is reached until it resets. */
export const USAGE_LIMIT = 'usage_limit_reached';

/** The plan does not include Codex. */
export const NOT_INCLUDED = 'usage_not_included';

/**
 * The errors that Codex stops at rather than retrying: by `type` in an error
 * answer, by `code` in a stream. Sent again, they fail again until the plan
 * changes or resets.
 */
const PLAN_ERRORS = new Set([
  USAGE_LIMIT,
  NOT_INCLUDED,
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

type ErrorFields = { type?: unknown; code?: unknown };

/**
 * The error a failure carries: an error answer's body, or the event of a
 * stream, which has it at the top, under `error`, or in a failed response.
 */
function errorFields(data: unknown): ErrorFields | undefined {
  const frame = data as
    | (ErrorFields & {
        error?: ErrorFields;
        response?: { error?: ErrorFields };
      })
    | undefined;
  return frame?.response?.error ?? frame?.error ?? frame;
}

/** What the ChatGPT plan refused a request for, as Codex reads it. */
export function planErrorCode(error: unknown): string | null {
  if (RetryError.isInstance(error)) return planErrorCode(error.lastError);
  if (!StreamProviderError.isInstance(error) && !APICallError.isInstance(error))
    return null;
  const fields = errorFields(error.data);
  for (const value of [fields?.type, fields?.code]) {
    if (typeof value === 'string' && PLAN_ERRORS.has(value)) return value;
  }
  return null;
}

/** Whether the plan refused a request, which asking again would not change. */
export function stopsPlan(error: unknown): boolean {
  return planErrorCode(error) !== null;
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

function planParams(params: CallOptions): CallOptions {
  return {
    ...params,
    temperature: undefined,
    topP: undefined,
    maxOutputTokens: undefined,
    // Read for the event that ends the response; see `wrapStream`.
    includeRawChunks: true,
    providerOptions: withOpenAi(params.providerOptions, {
      store: false,
      systemMessageMode: 'developer',
      // Every Codex model reasons; with nothing stored, its reasoning comes
      // back encrypted to be sent again.
      forceReasoning: true,
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
