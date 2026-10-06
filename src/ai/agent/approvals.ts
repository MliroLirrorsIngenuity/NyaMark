/**
 * What the assistant asks the user before it does: writing a note other
 * than the open document, reaching a folder the user has yet to give it,
 * opening a page on this computer or the local network, or running a tool
 * of an MCP server. A tool waits on the answer; the panel shows the
 * question under the tool's line in the reply and answers it.
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
    }
  | {
      kind: 'page';
      url: string;
      /** The private host the page is on, or redirects to. */
      host: string;
    }
  | {
      kind: 'tool';
      /** The server's id, and its name as the user gave it. */
      server: string;
      serverName: string;
      tool: string;
      /** The arguments, as JSON to show. */
      input: string;
    };

/**
 * `always` allows writes, or the MCP tool asked about, for the rest of the
 * conversation. Allowing a page allows its host for the rest of the
 * conversation.
 */
export type ApprovalAnswer = 'allow' | 'always' | 'deny';

/**
 * What a tool returns when the user turned it down, why in the model's
 * terms. The model is told as the SDK tells it of a denied call; the panel
 * shows the call as turned down.
 */
export type Denied = { denied: string };

export const isDenied = (output: unknown): output is Denied =>
  typeof (output as Partial<Denied> | null)?.denied === 'string';

/** A tool's output as the model reads it: its text, or the denial. */
export const modelOutput = (output: { text: string } | Denied) =>
  isDenied(output)
    ? { type: 'execution-denied' as const, reason: output.denied }
    : { type: 'text' as const, value: output.text };

const toolKey = (server: string, tool: string) => `${server}\u0000${tool}`;

type Waiting = {
  request: ApprovalRequest;
  answer: (answer: ApprovalAnswer) => void;
};

export class Approvals {
  private readonly waiting = new Map<string, Waiting>();
  private writesAllowed = false;
  private readonly hostsAllowed = new Set<string>();
  private readonly toolsAllowed = new Set<string>();
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
    if (request.kind === 'page' && this.hostAllowed(request.host)) {
      return Promise.resolve('allow');
    }
    if (
      request.kind === 'tool' &&
      this.toolAllowed(request.server, request.tool)
    ) {
      return Promise.resolve('allow');
    }
    if (signal?.aborted) return Promise.resolve('deny');
    return new Promise((resolve) => {
      const stop = () => answer('deny');
      const answer = (given: ApprovalAnswer) => {
        if (!this.waiting.has(id)) return;
        signal?.removeEventListener('abort', stop);
        this.waiting.delete(id);
        if (given === 'always' && request.kind === 'write') {
          this.writesAllowed = true;
        }
        if (given === 'always' && request.kind === 'tool') {
          this.toolsAllowed.add(toolKey(request.server, request.tool));
        }
        if (request.kind === 'page' && given !== 'deny') {
          this.hostsAllowed.add(request.host.toLowerCase());
        }
        this.changed();
        resolve(given);
      };
      signal?.addEventListener('abort', stop, { once: true });
      this.waiting.set(id, { request, answer });
      this.changed();
    });
  }

  /** Whether the user let the assistant open pages on `host`. */
  hostAllowed(host: string): boolean {
    return this.hostsAllowed.has(host.toLowerCase());
  }

  /** The private hosts the user let the assistant open pages on. */
  allowedHosts(): string[] {
    return [...this.hostsAllowed];
  }

  /** Whether the user let the MCP server's tool run without asking. */
  toolAllowed(server: string, tool: string): boolean {
    return this.toolsAllowed.has(toolKey(server, tool));
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
    this.hostsAllowed.clear();
    this.toolsAllowed.clear();
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
