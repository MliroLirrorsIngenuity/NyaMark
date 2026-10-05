/**
 * One request to the model for a command of the AI or the slash menu: no
 * tools and no conversation, the reply streamed as it comes.
 */

import { type LanguageModel, streamText } from 'ai';

export async function askModel(
  model: LanguageModel,
  request: { instructions: string; prompt: string },
  onText: (text: string) => void,
  signal: AbortSignal
): Promise<string> {
  const result = streamText({
    model,
    instructions: request.instructions,
    prompt: request.prompt,
    abortSignal: signal,
    // The menu shows it; the console would only repeat it.
    onError: () => {},
  });
  let text = '';
  let failure: unknown = null;
  for await (const part of result.stream) {
    if (part.type === 'text-delta') {
      text += part.text;
      onText(text);
    } else if (part.type === 'error') {
      failure ??= part.error;
    }
  }
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  if (failure) throw failure;
  return text;
}
