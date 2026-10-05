/**
 * Suggests the next words while the user writes: once typing stops for the
 * pause set, at a caret that can take them, the model is asked how the text
 * goes on and the editor shows its answer grey after the caret. Every key
 * drops what is waiting or asked for. A suggestion that fails shows nothing.
 */

import type { SuggestDriver, SuggestSpot } from '../../editor/suggest';
import type { AiSettings } from '../../state/ai-settings';
import { getSettings } from '../../state/settings';
import { connectModel } from '../providers/connect';
import { cleanSuggestion, suggestPrompt } from './prompt';
import { suggestText } from './request';

export type SuggestHost = {
  /** The document's path, null while it has none. */
  documentPath: () => string | null;
};

/** The model suggestions use: their own, or the AI menu's, or the chat's. */
export function suggestModel(ai: AiSettings) {
  const ref = ai.completeModel ?? ai.quickModel ?? ai.chatModel;
  const provider = ref && ai.providers.find((p) => p.id === ref.provider);
  return ref && provider ? { ref, provider } : null;
}

/** How much of either side tells one place apart for the cache. */
const KEY_BEFORE = 400;
const KEY_AFTER = 200;
const CACHE_SIZE = 40;

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

export class CompletionDriver implements SuggestDriver {
  private timer: number | null = null;
  private running: AbortController | null = null;
  /** The suggestion for each place asked about lately, empty for none. */
  private readonly cache = new Map<string, string>();
  private warned = false;

  constructor(private readonly host: SuggestHost) {}

  changed(spot: () => SuggestSpot | null, typed: boolean) {
    this.stop();
    if (!typed) return;
    const { complete } = getSettings().ai;
    if (!complete.enabled) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.suggest(spot);
    }, complete.delay);
  }

  stop() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.running?.abort();
    this.running = null;
  }

  private async suggest(read: () => SuggestSpot | null) {
    const spot = read();
    if (!spot) return;
    const ai = getSettings().ai;
    if (!ai.complete.enabled) return;
    if (ai.complete.atEndOnly && !spot.atEnd) return;
    // Nothing on the line yet to carry on from.
    if (!spot.line.trim()) return;
    const chosen = suggestModel(ai);
    if (!chosen) return;

    const key = [
      spot.markdown ? 'md' : 'text',
      spot.before.slice(-KEY_BEFORE),
      spot.after.slice(0, KEY_AFTER),
    ].join('\u0000');
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      if (cached) spot.show(cached);
      return;
    }

    const controller = new AbortController();
    this.running = controller;
    const path = this.host.documentPath();
    try {
      const reply = await suggestText(
        connectModel(
          chosen.provider,
          chosen.ref.model,
          () => getSettings().ai.proxy
        ),
        suggestPrompt(
          {
            title: path ? fileName(path) : null,
            before: spot.before,
            after: spot.after,
            markdown: spot.markdown,
          },
          ai.instructions
        ),
        controller.signal
      );
      if (this.running !== controller) return;
      this.running = null;
      const text = cleanSuggestion(reply, spot.before, spot.after);
      this.remember(key, text);
      if (text) spot.show(text);
    } catch (error) {
      if (this.running === controller) this.running = null;
      if (controller.signal.aborted) return;
      // Once, for whoever looks: every pause in typing would repeat it.
      if (!this.warned) {
        this.warned = true;
        console.warn('[ai] A suggestion failed', error);
      }
    }
  }

  private remember(key: string, text: string) {
    this.cache.delete(key);
    this.cache.set(key, text);
    if (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
