import {
  type AiEffort,
  type AiProvider,
  isAiEffort,
} from '../../state/ai-settings';
import { CODEX_MODELS, CODEX_VERSION } from './chatgpt';
import { baseUrlOf } from './factory';

/** A model a service lists, with what it says about it. */
export type ListedModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  /** The levels of thought it takes, as the service lists them. */
  efforts?: AiEffort[];
  defaultEffort?: AiEffort;
};

export class ModelListError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const ANTHROPIC_VERSION = '2023-06-01';

async function getJson(
  fetch: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(url, { headers, signal });
  const body = await response.text();
  if (!response.ok) {
    throw new ModelListError(response.status, errorMessage(body, response));
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ModelListError(response.status, body.slice(0, 200));
  }
}

/** What a service said went wrong, from the usual error shapes. */
export function errorMessage(body: string, response: Response): string {
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error ?? parsed;
    const message =
      typeof error === 'string'
        ? error
        : (error?.message ?? parsed?.message ?? parsed?.detail);
    if (typeof message === 'string' && message) {
      return `${response.status} ${message}`;
    }
  } catch {}
  const text = body.trim().slice(0, 200);
  return text
    ? `${response.status} ${text}`
    : `${response.status} ${response.statusText}`;
}

type Json = Record<string, unknown>;

function records(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Json => typeof entry === 'object' && entry !== null
      )
    : [];
}

function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** `data` of an OpenAI-style list, with OpenRouter's extra details. */
export function parseOpenAiModels(json: unknown): ListedModel[] {
  return records((json as Json)?.data).flatMap((entry) => {
    if (typeof entry.id !== 'string') return [];
    const architecture = entry.architecture as Json | undefined;
    const inputs = architecture?.input_modalities;
    const parameters = entry.supported_parameters;
    return [
      {
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        contextWindow: positive(entry.context_length ?? entry.context_window),
        vision: Array.isArray(inputs) ? inputs.includes('image') : undefined,
        tools: Array.isArray(parameters)
          ? parameters.includes('tools')
          : undefined,
        reasoning: Array.isArray(parameters)
          ? parameters.includes('reasoning')
          : undefined,
      },
    ];
  });
}

export function parseAnthropicModels(json: unknown): ListedModel[] {
  return records((json as Json)?.data).flatMap((entry) =>
    typeof entry.id === 'string'
      ? [
          {
            id: entry.id,
            name:
              typeof entry.display_name === 'string'
                ? entry.display_name
                : undefined,
            contextWindow: positive(entry.max_input_tokens),
          },
        ]
      : []
  );
}

/** Gemini models that write text; the rest embed or make pictures. */
export function parseGoogleModels(json: unknown): ListedModel[] {
  return records((json as Json)?.models).flatMap((entry) => {
    const methods = entry.supportedGenerationMethods;
    if (
      typeof entry.name !== 'string' ||
      (Array.isArray(methods) && !methods.includes('generateContent'))
    ) {
      return [];
    }
    return [
      {
        id: entry.name.replace(/^models\//, ''),
        name:
          typeof entry.displayName === 'string' ? entry.displayName : undefined,
        contextWindow: positive(entry.inputTokenLimit),
        reasoning:
          typeof entry.thinking === 'boolean' ? entry.thinking : undefined,
      },
    ];
  });
}

/**
 * The models a ChatGPT account may use in Codex, by priority as Codex
 * orders them: those it shows, by name, to be asked for by `slug`. Every
 * one reasons and calls tools.
 */
export function parseChatGptModels(json: unknown): ListedModel[] {
  const rank = (entry: Json) =>
    typeof entry.priority === 'number' ? entry.priority : Number.MAX_VALUE;
  return records((json as Json)?.models)
    .filter(
      (entry) => entry.visibility === 'list' && typeof entry.slug === 'string'
    )
    .sort((a, b) => rank(a) - rank(b))
    .map((entry) => ({
      id: String(entry.slug),
      name:
        typeof entry.display_name === 'string' ? entry.display_name : undefined,
      contextWindow: positive(entry.context_window),
      vision: Array.isArray(entry.input_modalities)
        ? entry.input_modalities.includes('image')
        : undefined,
      tools: true,
      reasoning: true,
      ...chatGptEfforts(entry),
    }));
}

/**
 * The levels of thought Codex lists for a model. Those the app has no name
 * for are left out, such as `ultra`, which hands the task to other agents.
 */
function chatGptEfforts(entry: Json) {
  const efforts = records(entry.supported_reasoning_levels)
    .map((level) => level.effort)
    .filter(isAiEffort);
  return {
    efforts: efforts.length ? efforts : undefined,
    defaultEffort: isAiEffort(entry.default_reasoning_level)
      ? entry.default_reasoning_level
      : undefined,
  };
}

/**
 * The models Codex lists for the account, or the ones it ships with when
 * the list fails, as Codex falls back to them. A sign-in that ended or a
 * connection that failed still fails.
 */
async function listChatGptModels(
  fetch: typeof globalThis.fetch,
  base: string,
  signal?: AbortSignal
): Promise<ListedModel[]> {
  try {
    const url = `${base}/models?client_version=${CODEX_VERSION}`;
    return parseChatGptModels(await getJson(fetch, url, {}, signal));
  } catch (error) {
    if (!(error instanceof ModelListError) || error.status === 401) throw error;
    return CODEX_MODELS;
  }
}

/** The models a service offers, as it lists them. */
export async function listModels(
  provider: AiProvider,
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal
): Promise<ListedModel[]> {
  const base = baseUrlOf(provider);
  if (provider.kind === 'anthropic') {
    const models: ListedModel[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const query: string = after
        ? `?limit=1000&after_id=${encodeURIComponent(after)}`
        : '?limit=1000';
      const json = (await getJson(
        fetch,
        `${base}/models${query}`,
        { 'anthropic-version': ANTHROPIC_VERSION },
        signal
      )) as Json;
      models.push(...parseAnthropicModels(json));
      if (json.has_more !== true || typeof json.last_id !== 'string') break;
      after = json.last_id;
    }
    return models;
  }
  if (provider.kind === 'google') {
    const models: ListedModel[] = [];
    let token: string | null = null;
    for (let page = 0; page < 20; page++) {
      const query: string = token
        ? `?pageSize=1000&pageToken=${encodeURIComponent(token)}`
        : '?pageSize=1000';
      const json = (await getJson(
        fetch,
        `${base}/models${query}`,
        {},
        signal
      )) as Json;
      models.push(...parseGoogleModels(json));
      if (typeof json.nextPageToken !== 'string' || !json.nextPageToken) break;
      token = json.nextPageToken;
    }
    return models;
  }
  if (provider.auth === 'chatgpt') {
    return await listChatGptModels(fetch, base, signal);
  }
  return parseOpenAiModels(await getJson(fetch, `${base}/models`, {}, signal));
}
