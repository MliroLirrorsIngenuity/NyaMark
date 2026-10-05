import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { Tool } from 'ai';
import type { AiProvider } from '../../state/ai-settings';
import { KEY_PLACEHOLDER } from './factory';

/** Searches a turn's model may run on the service's own search. */
const MAX_NATIVE_SEARCHES = 5;

/**
 * The service's own web search, run on its side and billed by it, for the
 * services that have one: Anthropic's and OpenAI's own APIs. Services that
 * only speak their API have no such search; null for those.
 */
export function nativeSearchTool(provider: AiProvider): Tool | null {
  if (provider.kind === 'anthropic' && provider.preset === 'anthropic') {
    return createAnthropic({
      apiKey: KEY_PLACEHOLDER,
    }).tools.webSearch_20250305({ maxUses: MAX_NATIVE_SEARCHES });
  }
  if (provider.kind === 'openai' && provider.preset === 'openai') {
    return createOpenAI({ apiKey: KEY_PLACEHOLDER }).tools.webSearch({});
  }
  return null;
}
