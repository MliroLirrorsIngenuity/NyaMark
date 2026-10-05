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
 * Save where a profile's requests may go and with which key. With no key and
 * `keepKey`, the saved key stays, as long as the address keeps its host;
 * otherwise the call fails with `key-needed`.
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

export async function deleteAiSecret(profile: string): Promise<void> {
  await invoke('ai_secret_delete', { profile });
}
