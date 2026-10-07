/**
 * How hard a reasoning model thinks: the levels it can be asked for, and
 * what a request sends to ask for the one chosen.
 */

import type { LanguageModelMiddleware } from 'ai';
import {
  AI_EFFORTS,
  type AiEffort,
  type AiModelInfo,
  type AiProvider,
} from '../../state/ai-settings';
import { CODEX_MODELS } from './chatgpt';

/**
 * What the service lists of the model's levels; for a ChatGPT model saved
 * before its list carried them, what Codex lists for it.
 */
function listing(
  provider: AiProvider,
  model: AiModelInfo
): Pick<AiModelInfo, 'efforts' | 'defaultEffort'> {
  if (model.efforts?.length || provider.auth !== 'chatgpt') return model;
  return CODEX_MODELS.find((entry) => entry.id === model.id) ?? model;
}

/**
 * The levels the service lists for the model, else those its API takes
 * from any model that reasons; none for a model that does not.
 */
export function effortLevels(
  provider: AiProvider,
  model: AiModelInfo
): readonly AiEffort[] {
  if (!model.reasoning) return [];
  const listed = listing(provider, model).efforts;
  if (listed?.length) return listed;
  switch (provider.kind) {
    // The SDK turns each level into what the model takes: an effort, a
    // budget of tokens, or no thinking.
    case 'anthropic':
      return ['none', 'low', 'medium', 'high', 'xhigh'];
    case 'google':
      return ['none', 'low', 'medium', 'high'];
    case 'openai-compatible':
      // DeepSeek thinks or not, and thinks at `high` or `max`.
      return provider.preset === 'deepseek'
        ? ['none', 'high', 'xhigh']
        : ['low', 'medium', 'high'];
    case 'openai':
      return AI_EFFORTS;
  }
}

/** The level the service uses when none is chosen, when it says which. */
export function defaultEffort(
  provider: AiProvider,
  model: AiModelInfo
): AiEffort | null {
  return listing(provider, model).defaultEffort ?? null;
}

/**
 * Asks each request to the model to think at the level chosen for it, or
 * null to leave that to the service. A request that names a level keeps it.
 */
export function effortMiddleware(
  provider: AiProvider,
  model: AiModelInfo | undefined
): LanguageModelMiddleware | null {
  const effort = model?.effort;
  if (!model || !effort || !effortLevels(provider, model).includes(effort)) {
    return null;
  }
  // The Responses API takes each level by its own name, `max` with them.
  if (provider.kind === 'openai') {
    return {
      specificationVersion: 'v4',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            reasoningEffort: effort,
            ...params.providerOptions?.openai,
          },
        },
      }),
    };
  }
  if (effort === 'max') return null;
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => ({
      ...params,
      reasoning: params.reasoning ?? effort,
    }),
  };
}
