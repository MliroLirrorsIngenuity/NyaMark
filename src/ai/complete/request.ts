/**
 * One request for a suggestion: streamed, and stopped once the reply has
 * run to the end of its first line, which is all that is shown of it.
 */

import { type LanguageModel, streamText } from 'ai';
import { replyDone } from './prompt';

export async function suggestText(
  model: LanguageModel,
  request: { instructions: string; prompt: string },
  signal: AbortSignal
): Promise<string> {
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const result = streamText({
      model,
      instructions: request.instructions,
      prompt: request.prompt,
      abortSignal: stop.signal,
      // A suggestion that fails is none; there is nothing to show of it.
      onError: () => {},
    });
    let text = '';
    let thought = false;
    for await (const part of result.stream) {
      if (part.type === 'reasoning-end') {
        thought = true;
      } else if (part.type === 'text-delta') {
        text += part.text;
        // A model that thought first sets the reply apart from the thinking
        // with a line break, which starts no new paragraph of the reply.
        if (thought) text = text.replace(/^[ \t]*\n+/, '');
        if (replyDone(text)) {
          stop.abort();
          break;
        }
      } else if (part.type === 'error') {
        if (!stop.signal.aborted) throw part.error;
      }
    }
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    return text;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
