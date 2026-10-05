/**
 * What the assistant asks the user before it does: writing a note other
 * than the open document, or reaching a folder the user has yet to give
 * it. A tool waits on the answer; the panel shows the question under the
 * tool's line in the reply and answers it.
 */

import type { LineDiff } from './line-diff';

export type ApprovalRequest =
  | {
      kind: 'write';
      /** The note as the assistant named it, and whether it is new. */
      path: string;
      created: boolean;
      diff: LineDiff;
    }
  | {
      kind: 'folder';
      /** Why the assistant asks, in its words. */
      reason: string;
    };

/** `always` allows writes for the rest of the conversation. */
export type ApprovalAnswer = 'allow' | 'always' | 'deny';

type Waiting = {
  request: ApprovalRequest;
  answer: (answer: ApprovalAnswer) => void;
};

export class Approvals {
  private readonly waiting = new Map<string, Waiting>();
  private writesAllowed = false;
  private readonly listeners = new Set<() => void>();

  /**
   * Asks the user, for the tool call `id`. Resolves with the answer, or
   * with `deny` when the turn is stopped first.
   */
  ask(
    id: string,
    request: ApprovalRequest,
    signal?: AbortSignal
  ): Promise<ApprovalAnswer> {
    if (request.kind === 'write' && this.writesAllowed) {
      return Promise.resolve('allow');
    }
    if (signal?.aborted) return Promise.resolve('deny');
    return new Promise((resolve) => {
      const stop = () => answer('deny');
      const answer = (given: ApprovalAnswer) => {
        if (!this.waiting.has(id)) return;
        signal?.removeEventListener('abort', stop);
        this.waiting.delete(id);
        if (given === 'always') this.writesAllowed = true;
        this.changed();
        resolve(given);
      };
      signal?.addEventListener('abort', stop, { once: true });
      this.waiting.set(id, { request, answer });
      this.changed();
    });
  }

  /** The question waiting for the tool call `id`, if any. */
  request(id: string): ApprovalRequest | null {
    return this.waiting.get(id)?.request ?? null;
  }

  answer(id: string, answer: ApprovalAnswer) {
    this.waiting.get(id)?.answer(answer);
  }

  /** A new conversation: what was waiting is turned down, nothing allowed. */
  reset() {
    for (const waiting of [...this.waiting.values()]) waiting.answer('deny');
    this.writesAllowed = false;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }
}
