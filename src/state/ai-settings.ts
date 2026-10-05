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

/** How the app reaches an MCP server. */
export type AiMcpTransport = 'stdio' | 'http';

/**
 * A Model Context Protocol server the user added. Both ways of reaching it
 * are kept, so switching between them loses nothing typed.
 */
export type AiMcpServer = {
  /** Names the server, and its key in the keychain as `mcp-<id>`. */
  id: string;
  name: string;
  enabled: boolean;
  transport: AiMcpTransport;
  /** A program on this computer, spoken to over its stdin and stdout. */
  command: string;
  args: string[];
  env: [string, string][];
  /** Where the program runs; empty for the user's home folder. */
  cwd: string;
  /** A service reached over HTTP. */
  url: string;
  headers: [string, string][];
  /** Sends the key saved for the server as a bearer token. */
  useKey: boolean;
  /** The tools that run without asking each time. */
  allowed: string[];
};

/**
 * A command of the AI menu over the selection: what it is called and what
 * it asks of the model. The built-in ones keep their name and prompt empty
 * until the user writes their own, and read in the app's language till then.
 */
export type AiQuickAction = { id: string; name: string; prompt: string };

/** The AI menu's commands as they come, by id. */
export const BUILTIN_QUICK_ACTIONS = [
  'polish',
  'rewrite',
  'shorter',
  'longer',
  'grammar',
  'formal',
  'casual',
  'translate-en',
  'translate-zh',
] as const;

export type BuiltinQuickAction = (typeof BUILTIN_QUICK_ACTIONS)[number];

export function isBuiltinQuickAction(id: string): id is BuiltinQuickAction {
  return (BUILTIN_QUICK_ACTIONS as readonly string[]).includes(id);
}

/** The AI menu as it comes. */
export function defaultQuickActions(): AiQuickAction[] {
  return BUILTIN_QUICK_ACTIONS.map((id) => ({ id, name: '', prompt: '' }));
}

/** The pauses in typing a suggestion can wait for, in milliseconds. */
export const COMPLETE_DELAYS = [300, 500, 700, 1000, 1500, 2000] as const;

export type AiCompleteSettings = {
  /** Suggest the next words while the user writes. */
  enabled: boolean;
  /** How long typing stops before a suggestion is asked for, one of `COMPLETE_DELAYS`. */
  delay: number;
  /** Only with nothing but white space after the caret in its paragraph. */
  atEndOnly: boolean;
};

export type AiSettings = {
  providers: AiProvider[];
  /** The model the assistant panel talks to. */
  chatModel: AiModelRef | null;
  /** For the selection and slash commands; `null` uses the chat model. */
  quickModel: AiModelRef | null;
  /** For the suggestions while writing; `null` uses the quick model. */
  completeModel: AiModelRef | null;
  proxy: ProxySetting;
  /** What the user wants the assistant always to keep in mind. */
  instructions: string;
  editMode: AiEditMode;
  search: AiSearchSettings;
  mcpServers: AiMcpServer[];
  quickActions: AiQuickAction[];
  complete: AiCompleteSettings;
};

export const defaultAiSettings: AiSettings = {
  providers: [],
  chatModel: null,
  quickModel: null,
  completeModel: null,
  proxy: { mode: 'system' },
  instructions: '',
  editMode: 'review',
  search: { engine: 'auto', searxngUrl: '', native: false },
  mcpServers: [],
  quickActions: defaultQuickActions(),
  complete: { enabled: false, delay: 700, atEndOnly: true },
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Short enough to name a keychain entry once `mcp-` goes before it. */
const MCP_ID = /^[A-Za-z0-9_-]{1,60}$/;
const MAX_MCP_SERVERS = 50;
const QUICK_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_QUICK_ACTIONS = 40;

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

function pairs(value: unknown, max: number): [string, string][] {
  const result: [string, string][] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const name = text(entry[0], 500).trim();
    if (name) result.push([name, text(entry[1], 20_000)]);
    if (result.length === max) break;
  }
  return result;
}

function strings(value: unknown, max: number, length: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, max)
    .map((entry) => entry.slice(0, length));
}

function sanitizeMcpServer(value: unknown): AiMcpServer | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (!MCP_ID.test(value.id)) return null;
  return {
    id: value.id,
    name: text(value.name, 100).trim() || value.id,
    enabled: bool(value.enabled, true),
    transport: value.transport === 'http' ? 'http' : 'stdio',
    command: text(value.command, 2000).trim(),
    args: strings(value.args, 200, 4000),
    env: pairs(value.env, 200),
    cwd: text(value.cwd, 2000).trim(),
    url: text(value.url, 2000).trim(),
    headers: pairs(value.headers, 50),
    useKey: bool(value.useKey, false),
    allowed: [...new Set(strings(value.allowed, 500, 200))],
  };
}

function sanitizeQuickActions(value: unknown): AiQuickAction[] {
  if (!Array.isArray(value)) return defaultQuickActions();
  const actions: AiQuickAction[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    if (!QUICK_ID.test(entry.id)) continue;
    if (actions.some((other) => other.id === entry.id)) continue;
    actions.push({
      id: entry.id,
      name: text(entry.name, 100).trim(),
      prompt: text(entry.prompt, 8000).trim(),
    });
    if (actions.length === MAX_QUICK_ACTIONS) break;
  }
  return actions;
}

function sanitizeComplete(value: unknown): AiCompleteSettings {
  const complete = isRecord(value) ? value : {};
  const asked = complete.delay;
  // The pause offered nearest to the one saved.
  let delay = 700;
  if (typeof asked === 'number' && Number.isFinite(asked)) {
    for (const option of COMPLETE_DELAYS) {
      if (Math.abs(option - asked) < Math.abs(delay - asked)) delay = option;
    }
  }
  return {
    enabled: bool(complete.enabled, false),
    delay,
    atEndOnly: bool(complete.atEndOnly, true),
  };
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
  const mcpServers: AiMcpServer[] = [];
  for (const entry of Array.isArray(ai.mcpServers) ? ai.mcpServers : []) {
    const server = sanitizeMcpServer(entry);
    if (server && !mcpServers.some((other) => other.id === server.id)) {
      mcpServers.push(server);
    }
    if (mcpServers.length === MAX_MCP_SERVERS) break;
  }
  return {
    providers,
    chatModel: sanitizeModelRef(ai.chatModel, providers),
    quickModel: sanitizeModelRef(ai.quickModel, providers),
    completeModel: sanitizeModelRef(ai.completeModel, providers),
    proxy: sanitizeProxy(ai.proxy),
    instructions: text(ai.instructions, 20_000),
    editMode: ai.editMode === 'auto' ? 'auto' : 'review',
    search: sanitizeSearch(ai.search),
    mcpServers,
    quickActions: sanitizeQuickActions(ai.quickActions),
    complete: sanitizeComplete(ai.complete),
  };
}

/** A fresh id for a provider's keychain entry. */
export function newAiProfileId(): string {
  return `p-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** A fresh id for an MCP server. */
export function newMcpServerId(): string {
  return `s-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** A fresh id for a command of the AI menu. */
export function newQuickActionId(): string {
  return `q-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** The keychain profile an MCP server's key is saved under. */
export function mcpKeyProfile(id: string): string {
  return `mcp-${id}`;
}
