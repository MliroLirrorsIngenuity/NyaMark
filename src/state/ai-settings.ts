// Pure types, defaults and checks for the AI part of the settings. Keys are
// never here: they live in the system keychain, by provider id.
import type { ProxySetting, WebSearchEngine } from '../bridge/ipc/ai';

/** The API a provider speaks. */
export type AiProviderKind =
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'deepseek';

export const AI_PROVIDER_KINDS: readonly AiProviderKind[] = [
  'openai',
  'openai-compatible',
  'anthropic',
  'google',
  'deepseek',
];

export type AiModelInfo = {
  id: string;
  /** Takes images. */
  vision: boolean;
  /** Can call tools, which the assistant needs to read and edit. */
  tools: boolean;
  /** Thinks before it answers. */
  reasoning: boolean;
  /** The tokens it reads at most. */
  contextWindow: number;
};

export type AiProvider = {
  /** Names the provider's key in the keychain: `[A-Za-z0-9_-]{1,64}`. */
  id: string;
  name: string;
  /** The preset it was added from, `custom` for none. */
  preset: string;
  kind: AiProviderKind;
  baseUrl: string;
  models: AiModelInfo[];
};

export type AiModelRef = { provider: string; model: string };

/** The assistant's edits: shown to accept or reject, or applied right away. */
export type AiEditMode = 'review' | 'auto';

/** Where the assistant searches the web; auto tries each engine in turn. */
export type AiSearchEngine = WebSearchEngine;

export const AI_SEARCH_ENGINES: readonly AiSearchEngine[] = [
  'auto',
  'bing',
  'duckduckgo',
  'searxng',
];

export type AiSearchSettings = {
  engine: AiSearchEngine;
  /** The SearXNG instance searched when the engine is `searxng`. */
  searxngUrl: string;
  /** Use the service's own web search where it has one. */
  native: boolean;
};

export type AiSettings = {
  providers: AiProvider[];
  /** The model the assistant panel talks to. */
  chatModel: AiModelRef | null;
  /** For the selection and slash commands; `null` uses the chat model. */
  quickModel: AiModelRef | null;
  proxy: ProxySetting;
  /** What the user wants the assistant always to keep in mind. */
  instructions: string;
  editMode: AiEditMode;
  search: AiSearchSettings;
};

export const defaultAiSettings: AiSettings = {
  providers: [],
  chatModel: null,
  quickModel: null,
  proxy: { mode: 'system' },
  instructions: '',
  editMode: 'review',
  search: { engine: 'auto', searxngUrl: '', native: false },
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isAiProfileId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeModel(value: unknown): AiModelInfo | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 200).trim();
  if (!id) return null;
  const context = Number(value.contextWindow);
  return {
    id,
    vision: bool(value.vision, false),
    tools: bool(value.tools, true),
    reasoning: bool(value.reasoning, false),
    contextWindow:
      Number.isFinite(context) && context >= 1024
        ? Math.min(Math.round(context), 10_000_000)
        : 128_000,
  };
}

function sanitizeProvider(value: unknown): AiProvider | null {
  if (!isRecord(value) || !isAiProfileId(value.id)) return null;
  const kind = AI_PROVIDER_KINDS.includes(value.kind as AiProviderKind)
    ? (value.kind as AiProviderKind)
    : null;
  if (!kind) return null;
  const models: AiModelInfo[] = [];
  for (const entry of Array.isArray(value.models) ? value.models : []) {
    const model = sanitizeModel(entry);
    if (model && !models.some((other) => other.id === model.id)) {
      models.push(model);
    }
  }
  return {
    id: value.id,
    name: text(value.name, 100).trim() || value.id,
    preset: text(value.preset, 64) || 'custom',
    kind,
    baseUrl: text(value.baseUrl, 2000).trim(),
    models: models.slice(0, 1000),
  };
}

function sanitizeModelRef(
  value: unknown,
  providers: AiProvider[]
): AiModelRef | null {
  if (!isRecord(value)) return null;
  const provider = providers.find((entry) => entry.id === value.provider);
  const model = provider?.models.find((entry) => entry.id === value.model);
  if (!provider || !model) return null;
  return { provider: provider.id, model: model.id };
}

function sanitizeProxy(value: unknown): ProxySetting {
  if (!isRecord(value)) return { mode: 'system' };
  if (value.mode === 'none') return { mode: 'none' };
  if (value.mode === 'manual') {
    const url = text(value.url, 2000).trim();
    return url ? { mode: 'manual', url } : { mode: 'system' };
  }
  return { mode: 'system' };
}

function sanitizeSearch(value: unknown): AiSearchSettings {
  const search = isRecord(value) ? value : {};
  const searxngUrl = text(search.searxngUrl, 2000).trim();
  let engine = AI_SEARCH_ENGINES.includes(search.engine as AiSearchEngine)
    ? (search.engine as AiSearchEngine)
    : 'auto';
  // SearXNG with no address to search at searches as auto does.
  if (engine === 'searxng' && !searxngUrl) engine = 'auto';
  return { engine, searxngUrl, native: bool(search.native, false) };
}

export function sanitizeAiSettings(value: unknown): AiSettings {
  const ai = isRecord(value) ? value : {};
  const providers: AiProvider[] = [];
  for (const entry of Array.isArray(ai.providers) ? ai.providers : []) {
    const provider = sanitizeProvider(entry);
    if (provider && !providers.some((other) => other.id === provider.id)) {
      providers.push(provider);
    }
  }
  return {
    providers,
    chatModel: sanitizeModelRef(ai.chatModel, providers),
    quickModel: sanitizeModelRef(ai.quickModel, providers),
    proxy: sanitizeProxy(ai.proxy),
    instructions: text(ai.instructions, 20_000),
    editMode: ai.editMode === 'auto' ? 'auto' : 'review',
    search: sanitizeSearch(ai.search),
  };
}

/** A fresh id for a provider's keychain entry. */
export function newAiProfileId(): string {
  return `p-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
