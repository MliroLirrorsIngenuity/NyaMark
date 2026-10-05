import { Channel, invoke } from '@tauri-apps/api/core';

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

/**
 * The folders the assistant may read and write notes in: the document's
 * folder first, then those the user picked for this window.
 */
export async function workspaceRoots(): Promise<string[]> {
  return await invoke<string[]>('workspace_roots');
}

/** Asks the user for another folder; null when they chose none. */
export async function pickWorkspaceRoot(): Promise<string | null> {
  return await invoke<string | null>('workspace_pick_root');
}

export async function listWorkspace(options: {
  glob?: string;
  limit?: number;
}): Promise<WorkspaceList> {
  return await invoke<WorkspaceList>('workspace_list', options);
}

export async function readWorkspaceFile(path: string): Promise<WorkspaceText> {
  return await invoke<WorkspaceText>('workspace_read', { path });
}

export async function searchWorkspace(options: {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}): Promise<WorkspaceMatches> {
  return await invoke<WorkspaceMatches>('workspace_search', options);
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
  return await invoke<WorkspaceWritten>('workspace_write', options);
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
