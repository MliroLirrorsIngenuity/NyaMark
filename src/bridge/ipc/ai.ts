import { Channel, type InvokeArgs, invoke } from '@tauri-apps/api/core';

/** A command the app could not run at all, as one sent bad arguments. */
export type InvokeFailure = { kind: 'invoke'; message: string };

/**
 * A failure an AI command reported, as the native side typed it (see
 * `src-tauri/src/ai`): each command family has its own kinds.
 */
abstract class AiCommandError<Failure extends { kind: string }> extends Error {
  constructor(readonly failure: Failure | InvokeFailure) {
    super(
      'message' in failure
        ? `${failure.kind}: ${failure.message}`
        : failure.kind
    );
  }
}

/** Calls the commands of a family; a failure is thrown as its error. */
function commands<Failure extends { kind: string }>(
  Failed: new (failure: Failure | InvokeFailure) => AiCommandError<Failure>
) {
  return async <T>(command: string, args?: InvokeArgs): Promise<T> => {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      const typed =
        typeof error === 'object' && error !== null && 'kind' in error;
      throw new Failed(
        typed ? (error as Failure) : { kind: 'invoke', message: String(error) }
      );
    }
  };
}

/** How AI requests reach the internet. */
export type ProxySetting =
  | { mode: 'system' }
  | { mode: 'none' }
  | { mode: 'manual'; url: string };

/** How a service expects its key. */
export type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'api-key';

export type AiFetchRequest = {
  id: string;
  profile: string;
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
  proxy: ProxySetting;
};

export type AiFetchHead = {
  status: number;
  headers: [string, string][];
};

export type AiFetchEvent =
  | { type: 'chunk'; text: string }
  | { type: 'end' }
  | { type: 'error'; message: string };

/**
 * Send a request through the app, which puts in the saved key of the
 * profile. Resolves with the status and headers; the body follows as events.
 */
export async function aiFetch(
  request: AiFetchRequest,
  onEvent: (event: AiFetchEvent) => void
): Promise<AiFetchHead> {
  const channel = new Channel<AiFetchEvent>();
  channel.onmessage = onEvent;
  return await invoke<AiFetchHead>('ai_fetch', { request, onEvent: channel });
}

export async function aiFetchAbort(id: string): Promise<void> {
  await invoke('ai_fetch_abort', { id });
}

/** What the settings show of a saved key; the key itself never comes back. */
export type AiSecretStatus = {
  saved: boolean;
  hasKey: boolean;
  origin: string | null;
  auth: AuthScheme | null;
  /** The last four characters of the key. */
  hint: string | null;
  storage: 'keychain' | 'file';
};

/**
 * Set where a profile's requests may go and with which key. With no key and
 * `keepKey`, the saved key stays, as long as the address keeps its host;
 * otherwise the call fails with `key-needed`. The change holds for this
 * window's requests until `commitAiSecrets` keeps it or `discardAiSecrets`
 * drops it.
 */
export async function setAiSecret(options: {
  profile: string;
  baseUrl: string;
  auth: AuthScheme;
  key: string | null;
  keepKey: boolean;
}): Promise<AiSecretStatus> {
  return await invoke<AiSecretStatus>('ai_secret_set', options);
}

export async function getAiSecretStatus(
  profile: string
): Promise<AiSecretStatus> {
  return await invoke<AiSecretStatus>('ai_secret_status', { profile });
}

/** Forget a profile's key, once `commitAiSecrets` confirms it. */
export async function deleteAiSecret(profile: string): Promise<void> {
  await invoke('ai_secret_delete', { profile });
}

/** Keep the key changes this window made. */
export async function commitAiSecrets(): Promise<void> {
  await invoke('ai_secrets_commit');
}

/** Drop the key changes this window made. */
export async function discardAiSecrets(): Promise<void> {
  await invoke('ai_secrets_discard');
}

/** A note in the window's workspace. */
export type WorkspaceFile = {
  path: string;
  /** From the folder it was found in, with `/` between parts. */
  relative: string;
  size: number;
  /** Milliseconds since the epoch. */
  modified: number | null;
};

export type WorkspaceList = { files: WorkspaceFile[]; truncated: boolean };

export type WorkspaceText = { path: string; text: string; version: string };

export type WorkspaceMatch = {
  path: string;
  relative: string;
  /** Counted from 1. */
  line: number;
  text: string;
};

export type WorkspaceMatches = {
  matches: WorkspaceMatch[];
  truncated: boolean;
};

export type WorkspaceWritten = { path: string; version: string };

export type WorkspaceFailure =
  | {
      kind:
        | 'no-workspace'
        | 'outside-workspace'
        | 'not-found'
        | 'not-markdown'
        | 'exists'
        | 'version-needed'
        | 'changed'
        | 'too-large'
        | 'not-utf8'
        | 'read-only'
        | 'empty-query';
    }
  | { kind: 'bad-glob' | 'bad-regex' | 'io'; message: string };

/** A workspace command failed (see `workspace.rs`). */
export class WorkspaceError extends AiCommandError<WorkspaceFailure> {}

const workspaceCommand = commands(WorkspaceError);

/**
 * The folders the assistant may read and write notes in: the document's
 * folder first, then those the user picked for this window.
 */
export async function workspaceRoots(): Promise<string[]> {
  return await workspaceCommand<string[]>('workspace_roots');
}

/** Asks the user for another folder; null when they chose none. */
export async function pickWorkspaceRoot(): Promise<string | null> {
  return await workspaceCommand<string | null>('workspace_pick_root');
}

export async function listWorkspace(options: {
  glob?: string;
  limit?: number;
}): Promise<WorkspaceList> {
  return await workspaceCommand<WorkspaceList>('workspace_list', options);
}

export async function readWorkspaceFile(path: string): Promise<WorkspaceText> {
  return await workspaceCommand<WorkspaceText>('workspace_read', { path });
}

export async function searchWorkspace(options: {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}): Promise<WorkspaceMatches> {
  return await workspaceCommand<WorkspaceMatches>('workspace_search', options);
}

/**
 * Writes a note: a new one with `create`, else one last read at
 * `expectedVersion`, left alone when it changed since.
 */
export async function writeWorkspaceFile(options: {
  path: string;
  text: string;
  expectedVersion?: string;
  create?: boolean;
}): Promise<WorkspaceWritten> {
  return await workspaceCommand<WorkspaceWritten>('workspace_write', options);
}

/** The engines web search reads; auto tries each in turn. */
export type WebSearchEngine = 'auto' | 'bing' | 'duckduckgo' | 'searxng';

export type WebSearchResult = { title: string; url: string; snippet: string };

export type WebSearchResponse = {
  /** The engine that answered. */
  engine: string;
  results: WebSearchResult[];
};

/** Searches the web through the result pages the engines show a browser. */
export async function webSearch(request: {
  query: string;
  engine: WebSearchEngine;
  searxngUrl?: string;
  proxy: ProxySetting;
  limit?: number;
}): Promise<WebSearchResponse> {
  return await invoke<WebSearchResponse>('web_search', { request });
}

export type WebPage = {
  /** Where the page was found, after redirects. */
  url: string;
  status: number;
  contentType: string;
  text: string;
  /** The page was too long and is cut off. */
  truncated: boolean;
};

/**
 * Fetches a page as text. Addresses on this machine and the local network
 * are refused unless `allowPrivate` is set.
 */
export async function webFetch(request: {
  url: string;
  proxy: ProxySetting;
  allowPrivate?: boolean;
}): Promise<WebPage> {
  return await invoke<WebPage>('web_fetch', { request });
}

export type ImageReadFailure =
  | { kind: 'forbidden' | 'not-found' | 'too-large' | 'not-an-image' }
  | { kind: 'io'; message: string };

/** An image could not be read for the assistant (see `images.rs`). */
export class ImageReadError extends AiCommandError<ImageReadFailure> {}

const imageCommand = commands(ImageReadError);

/**
 * Reads an image for the assistant: in the window's folders of notes, or a
 * file the user opened, picked or dropped. A relative path is taken from
 * the document's folder.
 */
export async function readImageForAi(path: string): Promise<Uint8Array> {
  return new Uint8Array(
    await imageCommand<ArrayBuffer>('read_image_for_ai', { path })
  );
}

/** A Model Context Protocol server, as the app starts it. */
export type McpServerConfig =
  | {
      transport: 'stdio';
      id: string;
      name: string;
      command: string;
      args: string[];
      env: [string, string][];
      cwd: string | null;
    }
  | {
      transport: 'http';
      id: string;
      name: string;
      url: string;
      headers: [string, string][];
      /** Sends the key saved under the profile `mcp-<id>`. */
      useKey: boolean;
    };

export type McpTool = {
  name: string;
  title: string | null;
  description: string | null;
  /** A JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
};

export type McpState = 'starting' | 'ready' | 'failed' | 'stopped';

export type McpStatus = {
  id: string;
  name: string;
  state: McpState;
  error: string | null;
  tools: McpTool[];
  /** What a local server last wrote to stderr, oldest first. */
  stderr: string[];
};

export type McpToolResult = {
  /** MCP content blocks: text, image, audio, resource or resource link. */
  content: Record<string, unknown>[];
  isError: boolean;
  structuredContent: unknown;
};

/**
 * Starts, stops and restarts the app's MCP servers to match `servers`, in
 * their order. Returns where each one is.
 */
export async function mcpSync(
  servers: McpServerConfig[],
  proxy: ProxySetting
): Promise<McpStatus[]> {
  return await invoke<McpStatus[]>('mcp_sync', { servers, proxy });
}

export async function mcpStatus(): Promise<McpStatus[]> {
  return await invoke<McpStatus[]>('mcp_status');
}

export async function mcpRestart(id: string): Promise<McpStatus> {
  return await invoke<McpStatus>('mcp_restart', { id });
}

export async function mcpCallTool(
  server: string,
  tool: string,
  args: Record<string, unknown> | null
): Promise<McpToolResult> {
  return await invoke<McpToolResult>('mcp_call_tool', {
    server,
    tool,
    arguments: args,
  });
}

/** A saved conversation, as the list of a document's conversations shows it. */
export type ConversationSummary = {
  id: string;
  title: string;
  /** Milliseconds since 1970. */
  updatedAt: number;
  messageCount: number;
};

export type HistoryFailure =
  | { kind: 'bad-id' | 'not-found' | 'too-large' | 'not-an-image' }
  | { kind: 'corrupt' | 'bad-image' | 'io'; message: string };

/** A saved conversation could not be read or kept (see `history.rs`). */
export class HistoryError extends AiCommandError<HistoryFailure> {}

const historyCommand = commands(HistoryError);

/**
 * Conversations are kept for the document at `document`, or for this
 * window's drafts while it has none.
 */
export async function listConversations(
  document: string | null
): Promise<ConversationSummary[]> {
  return await historyCommand<ConversationSummary[]>('history_list', {
    document,
  });
}

export async function readConversation(
  document: string | null,
  id: string
): Promise<unknown> {
  return await historyCommand<unknown>('history_read', { document, id });
}

export async function writeConversation(
  document: string | null,
  id: string,
  conversation: unknown
): Promise<void> {
  await historyCommand('history_write', { document, id, conversation });
}

export async function deleteConversation(
  document: string | null,
  id: string
): Promise<void> {
  await historyCommand('history_delete', { document, id });
}

/** Conversations follow the window's document to `to`; null is its drafts. */
export async function moveConversations(
  from: string | null,
  to: string | null
): Promise<void> {
  await historyCommand('history_move', { from, to });
}

export async function clearConversations(): Promise<void> {
  await historyCommand('history_clear');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/** Keeps an image of conversation `id`; returns the id to read it back by. */
export async function saveConversationImage(
  document: string | null,
  id: string,
  bytes: Uint8Array,
  mime: string
): Promise<string> {
  return await historyCommand<string>('history_save_image', {
    document,
    id,
    bytes: toBase64(bytes),
    mime,
  });
}

export async function readConversationImage(
  document: string | null,
  id: string,
  image: string
): Promise<Uint8Array> {
  return new Uint8Array(
    await historyCommand<ArrayBuffer>('history_read_image', {
      document,
      id,
      image,
    })
  );
}
