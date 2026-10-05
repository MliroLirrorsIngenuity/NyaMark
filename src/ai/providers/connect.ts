import { type ProxySetting, aiFetch, aiFetchAbort } from '../../bridge/ipc/ai';
import type { AiProvider } from '../../state/ai-settings';
import { createRustFetch } from '../transport/fetch';
import { languageModel } from './factory';

/** A `fetch` that sends through the app with the provider's saved key. */
export function providerFetch(
  provider: AiProvider,
  proxy: () => ProxySetting
): typeof fetch {
  return createRustFetch(
    { fetch: aiFetch, abort: aiFetchAbort },
    provider.id,
    proxy
  );
}

export function connectModel(
  provider: AiProvider,
  modelId: string,
  proxy: () => ProxySetting
) {
  return languageModel(provider, modelId, providerFetch(provider, proxy));
}
