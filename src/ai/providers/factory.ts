import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  type LanguageModel,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import type { AiProvider } from '../../state/ai-settings';
import { chatGptPlanMiddleware } from './chatgpt';
import { effortMiddleware } from './effort';

/**
 * What the page sends for a key. The app takes it out and puts in the key
 * saved for the provider; the page never has the key.
 */
export const KEY_PLACEHOLDER = 'nyamark-key';

export function baseUrlOf(provider: AiProvider): string {
  return provider.baseUrl.replace(/\/+$/, '');
}

type Model = Exclude<LanguageModel, string>;

/**
 * The model a provider serves under `modelId`, sending through `fetch`,
 * asked to think as hard as chosen for it.
 */
export function languageModel(
  provider: AiProvider,
  modelId: string,
  fetch: typeof globalThis.fetch
): Model {
  const model = serviceModel(provider, modelId, fetch);
  const middleware = effortMiddleware(
    provider,
    provider.models.find((entry) => entry.id === modelId)
  );
  return middleware ? wrapLanguageModel({ model, middleware }) : model;
}

function serviceModel(
  provider: AiProvider,
  modelId: string,
  fetch: typeof globalThis.fetch
): Model {
  const baseURL = baseUrlOf(provider);
  const apiKey = KEY_PLACEHOLDER;
  switch (provider.kind) {
    case 'openai': {
      const model = createOpenAI({ baseURL, apiKey, fetch }).responses(modelId);
      return provider.auth === 'chatgpt'
        ? wrapLanguageModel({ model, middleware: chatGptPlanMiddleware })
        : model;
    }
    case 'anthropic':
      return createAnthropic({ baseURL, apiKey, fetch })(modelId);
    case 'google':
      return createGoogle({ baseURL, apiKey, fetch })(modelId);
    case 'openai-compatible':
      // DeepSeek's Chat Completions has its own fields: the thinking switch,
      // and the thinking sent back with each tool call. Its SDK speaks them.
      if (provider.preset === 'deepseek') {
        return createDeepSeek({ baseURL, apiKey, fetch })(modelId);
      }
      // Models served this way often write their thinking into the reply,
      // between `<think>` tags; it is read out as reasoning.
      return wrapLanguageModel({
        model: createOpenAICompatible({
          name: 'compatible',
          baseURL,
          apiKey,
          fetch,
          includeUsage: true,
        }).chatModel(modelId),
        middleware: extractReasoningMiddleware({ tagName: 'think' }),
      });
  }
}
