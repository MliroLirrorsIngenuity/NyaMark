import { generateText } from 'ai';
import type { AiProvider } from '../../state/ai-settings';
import { languageModel } from './factory';
import { type ListedModel, ModelListError, listModels } from './models';

export type CheckResult =
  | { kind: 'models'; models: ListedModel[] }
  | { kind: 'answered'; model: string };

/**
 * Whether the service answers with the key and address given: its model
 * list, or, from a service that has none, a word from its first model.
 */
export async function checkProvider(
  provider: AiProvider,
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal
): Promise<CheckResult> {
  try {
    return {
      kind: 'models',
      models: await listModels(provider, fetch, signal),
    };
  } catch (error) {
    const model = provider.models[0]?.id;
    const unlisted =
      error instanceof ModelListError &&
      (error.status === 404 || error.status === 405);
    if (!unlisted || !model) throw error;
    await generateText({
      model: languageModel(provider, model, fetch),
      prompt: 'Reply with OK.',
      maxOutputTokens: 32,
      maxRetries: 0,
      abortSignal: signal,
    });
    return { kind: 'answered', model };
  }
}
