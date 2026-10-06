/**
 * One conversation with the assistant: what the panel shows, and the
 * messages the model is sent. A turn streams through the AI SDK's
 * `streamText`; the panel is told of each change and draws it.
 */

import {
  APICallError,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  RetryError,
  type ToolSet,
  stepCountIs,
  streamText,
} from 'ai';
import { AiFetchError } from '../../bridge/ipc/ai';
import { type ChatImage, userMessage } from '../images/image';

/** What a turn is sent with, read again for each turn and each retry. */
export type TurnSetup = {
  model: LanguageModel;
  /** The model's name as the reply shows it. */
  modelLabel: string;
  instructions: string;
  tools?: ToolSet;
};

/** A tool the model called, as the reply shows it. */
export type ToolPart = {
  type: 'tool';
  /** The call's id, as the model gave it. */
  id: string;
  name: string;
  /** What the model called it with; undefined while it is still writing it. */
  input: unknown;
  state: 'running' | 'done' | 'error' | 'stopped';
  output?: unknown;
  error?: string;
};

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | ToolPart;

export type ChatFailureCode =
  /** No model is chosen. */
  | 'no-model'
  /** The service has no key in the keychain. */
  | 'not-connected'
  /** The service's address changed since its key was entered. */
  | 'key-needed'
  /** The service refused the key. */
  | 'unauthorized'
  /** Too many requests, or the quota is spent. */
  | 'rate-limited'
  /** The service could not be reached. */
  | 'network'
  | 'other';

export type ChatFailure = {
  code: ChatFailureCode;
  message: string;
  status?: number;
};

export type ChatUsage = { input: number; output: number };

export type UserEntry = {
  id: number;
  role: 'user';
  text: string;
  images: ChatImage[];
};

export type AssistantEntry = {
  id: number;
  role: 'assistant';
  parts: ChatPart[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  model: string;
  error?: ChatFailure;
  usage?: ChatUsage;
  /** Why a reply that finished ended short of what the model meant to do. */
  ending?: 'step-limit' | 'length' | 'filtered';
  /** Where its messages begin in what the model is sent. */
  historyStart: number;
};

export type ChatEntry = UserEntry | AssistantEntry;

export type SessionChange =
  | { kind: 'reset' }
  | { kind: 'added'; entry: ChatEntry }
  | { kind: 'updated'; entry: ChatEntry }
  | { kind: 'removed'; entry: ChatEntry };

/** Model steps a turn may take before it is cut off. */
const MAX_STEPS = 40;

/** How the last step's finish reasons read once the turn is over. */
const ENDINGS: Partial<Record<FinishReason, AssistantEntry['ending']>> = {
  // The model still had tools to call: the turn ran out of steps.
  'tool-calls': 'step-limit',
  length: 'length',
  'content-filter': 'filtered',
};

export class ChatFailureError extends Error {
  constructor(readonly failure: ChatFailure) {
    super(failure.message);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** The service's own words from an error body, when it gave any. */
function serviceMessage(error: APICallError): string {
  const data = error.data as { error?: { message?: unknown } } | undefined;
  const fromData = data?.error?.message;
  if (typeof fromData === 'string' && fromData) return fromData;
  if (error.responseBody) {
    try {
      const body = JSON.parse(error.responseBody) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      const nested =
        typeof body.error === 'string' ? body.error : body.error?.message;
      const message = nested ?? body.message;
      if (typeof message === 'string' && message) return message;
    } catch {
      // Not JSON: the body itself, if short enough to read.
      const text = error.responseBody.trim();
      if (text && text.length <= 300) return text;
    }
  }
  return error.message;
}

/**
 * The app's reason a request failed: thrown as it is, or as the cause of
 * the `fetch` or SDK error it became.
 */
function fetchFailure(error: unknown): AiFetchError | null {
  if (error instanceof AiFetchError) return error;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof AiFetchError ? cause : null;
}

/** Sorts a failed turn's error into what the panel can say about it. */
export function describeFailure(error: unknown): ChatFailure {
  if (error instanceof ChatFailureError) return error.failure;
  const cause =
    RetryError.isInstance(error) && error.lastError != null
      ? error.lastError
      : error;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    const message = serviceMessage(cause);
    if (status === 401 || status === 403) {
      return { code: 'unauthorized', message, status };
    }
    if (status === 429) return { code: 'rate-limited', message, status };
    if (status == null) return { code: 'network', message };
    return { code: 'other', message, status };
  }
  const message = errorMessage(cause);
  switch (fetchFailure(cause)?.failure.kind) {
    case 'not-connected':
      return { code: 'not-connected', message };
    case 'key-needed':
      return { code: 'key-needed', message };
    case 'network':
    case 'bad-proxy':
      return { code: 'network', message };
    default:
      return { code: 'other', message };
  }
}

/** A message put into a turn's messages after the response message `at`. */
export type Inserted = { at: number; message: ModelMessage };

/**
 * A turn's response messages with what was put among them on the way, each
 * after the messages that came before it.
 */
export function withInserted(
  response: readonly ModelMessage[],
  inserted: readonly Inserted[]
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let next = 0;
  const ordered = [...inserted].sort((a, b) => a.at - b.at);
  for (let index = 0; index <= response.length; index++) {
    while (next < ordered.length && ordered[next].at <= index) {
      messages.push(ordered[next++].message);
    }
    if (index < response.length) messages.push(response[index]);
  }
  for (; next < ordered.length; next++) messages.push(ordered[next].message);
  return messages;
}

function addUsage(
  total: ChatUsage | undefined,
  usage: LanguageModelUsage
): ChatUsage {
  return {
    input: (total?.input ?? 0) + (usage.inputTokens ?? 0),
    output: (total?.output ?? 0) + (usage.outputTokens ?? 0),
  };
}

/** The text a reply shows, without its reasoning and tools. */
export function replyText(entry: AssistantEntry): string {
  let text = '';
  for (const part of entry.parts) {
    if (part.type === 'text') text += part.text;
  }
  return text;
}

export class ChatSession {
  readonly entries: ChatEntry[] = [];
  private history: ModelMessage[] = [];
  private running: AbortController | null = null;
  /** Images a tool opened, for the model to see before its next step. */
  private shown: ModelMessage[] = [];
  private nextId = 1;
  private readonly listeners = new Set<(change: SessionChange) => void>();

  constructor(private readonly prepare: () => TurnSetup | Promise<TurnSetup>) {}

  get busy(): boolean {
    return this.running != null;
  }

  /** What the model is sent next, before the next message. */
  get messages(): readonly ModelMessage[] {
    return this.history;
  }

  subscribe(listener: (change: SessionChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once the reply is done, stopped or failed. */
  async send(text: string, images: readonly ChatImage[] = []): Promise<void> {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || this.busy) return;
    const entry: UserEntry = {
      id: this.nextId++,
      role: 'user',
      text: trimmed,
      images: [...images],
    };
    this.entries.push(entry);
    this.history.push(userMessage(trimmed, images));
    this.emit({ kind: 'added', entry });
    await this.run();
  }

  /**
   * Has the model see images a tool opened. Tool results carry only text
   * through some services' APIs, so the images go as the user's message,
   * before the model's next step.
   */
  showModel(caption: string, images: readonly ChatImage[]) {
    if (!this.running || images.length === 0) return;
    const message = userMessage(caption, images);
    this.shown.push(message);
  }

  /** Asks again in place of the last reply, which failed or was stopped. */
  async retry(): Promise<void> {
    if (this.busy) return;
    const last = this.entries[this.entries.length - 1];
    if (last?.role !== 'assistant' || last.status === 'done') return;
    this.entries.pop();
    this.history.length = last.historyStart;
    this.emit({ kind: 'removed', entry: last });
    await this.run();
  }

  stop() {
    this.running?.abort();
  }

  /** Starts over; a reply on its way is stopped and dropped. */
  clear() {
    this.stop();
    this.running = null;
    this.entries.length = 0;
    this.history = [];
    this.emit({ kind: 'reset' });
  }

  /**
   * What is kept of the conversation: the entries and what the model is
   * sent, without a reply still on its way.
   */
  saved(): { entries: ChatEntry[]; messages: ModelMessage[] } {
    const last = this.entries[this.entries.length - 1];
    if (this.running && last?.role === 'assistant') {
      return {
        entries: this.entries.slice(0, -1),
        messages: this.history.slice(0, last.historyStart),
      };
    }
    return { entries: [...this.entries], messages: [...this.history] };
  }

  /** Puts back a conversation kept before, in place of this one. */
  restore(entries: readonly ChatEntry[], messages: readonly ModelMessage[]) {
    this.stop();
    this.running = null;
    this.entries.length = 0;
    this.entries.push(...entries);
    this.history = [...messages];
    let last = 0;
    for (const entry of entries) last = Math.max(last, entry.id);
    this.nextId = last + 1;
    this.emit({ kind: 'reset' });
  }

  private emit(change: SessionChange) {
    for (const listener of this.listeners) listener(change);
  }

  private async run() {
    const controller = new AbortController();
    this.running = controller;
    const entry: AssistantEntry = {
      id: this.nextId++,
      role: 'assistant',
      parts: [],
      status: 'streaming',
      model: '',
      historyStart: this.history.length,
    };
    this.entries.push(entry);
    this.emit({ kind: 'added', entry });

    // The messages of the steps that finished, and the text of the one
    // under way: kept when the turn is stopped or fails part way.
    const finished: ModelMessage[] = [];
    // The images tools opened, and where among the steps they went.
    const inserted: Inserted[] = [];
    this.shown = [];
    const takeShown = (at: number) => {
      for (const message of this.shown) inserted.push({ at, message });
      const shown = this.shown;
      this.shown = [];
      return shown;
    };
    let stepText = '';
    let failure: unknown = null;
    let stopped = false;
    const update = () => {
      if (this.running === controller) this.emit({ kind: 'updated', entry });
    };

    try {
      const setup = await this.prepare();
      if (controller.signal.aborted) throw controller.signal.reason;
      entry.model = setup.modelLabel;
      const result = streamText({
        model: setup.model,
        instructions: setup.instructions,
        messages: [...this.history],
        tools: setup.tools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: controller.signal,
        prepareStep: ({ messages, responseMessages }) => {
          if (this.running !== controller || this.shown.length === 0) {
            return undefined;
          }
          // Kept for the steps after this one too.
          return {
            messages: [...messages, ...takeShown(responseMessages.length)],
          };
        },
        onStepFinish: (step) => {
          finished.push(...step.response.messages);
        },
        // Shown in the panel; the console would only repeat it.
        onError: () => {},
      });

      for await (const part of result.stream) {
        switch (part.type) {
          case 'start-step':
            stepText = '';
            break;
          case 'text-delta':
            this.append(entry, 'text', part.text);
            stepText += part.text;
            update();
            break;
          case 'reasoning-delta':
            this.append(entry, 'reasoning', part.text);
            update();
            break;
          case 'tool-input-start':
            this.tool(entry, part.id, part.toolName);
            update();
            break;
          case 'tool-call':
            this.tool(entry, part.toolCallId, part.toolName).input = part.input;
            update();
            break;
          case 'tool-result': {
            if (part.preliminary) break;
            const tool = this.tool(entry, part.toolCallId, part.toolName);
            tool.state = 'done';
            tool.output = part.output;
            update();
            break;
          }
          case 'tool-error': {
            const tool = this.tool(entry, part.toolCallId, part.toolName);
            tool.state = 'error';
            tool.error = errorMessage(part.error);
            update();
            break;
          }
          case 'finish-step':
            stepText = '';
            entry.usage = addUsage(entry.usage, part.usage);
            update();
            break;
          case 'finish':
            entry.ending = ENDINGS[part.finishReason];
            break;
          case 'error':
            failure ??= part.error;
            break;
          case 'abort':
            stopped = true;
            break;
          default:
            break;
        }
      }
      if (!stopped && !failure) {
        const messages = await result.responseMessages;
        if (this.running !== controller) return;
        // Images opened in the last step go after it, for the next turn.
        takeShown(messages.length);
        this.history.push(...withInserted(messages, inserted));
        entry.status = 'done';
      }
    } catch (error) {
      if (controller.signal.aborted) stopped = true;
      else failure ??= error;
    }

    // Cleared while it ran: the entry is gone already.
    if (this.running !== controller) return;
    this.running = null;
    for (const part of entry.parts) {
      if (part.type === 'tool' && part.state === 'running') {
        part.state = 'stopped';
      }
    }
    if (entry.status !== 'done') {
      // What the model said before it stopped is kept, so a follow-up
      // can refer to it; a retry drops it again.
      takeShown(finished.length);
      this.history.push(...withInserted(finished, inserted));
      if (stepText) this.history.push({ role: 'assistant', content: stepText });
      // Stopping can surface as an error of its own; it is still a stop.
      if (controller.signal.aborted || (stopped && failure == null)) {
        entry.status = 'stopped';
      } else {
        entry.status = 'error';
        entry.error = describeFailure(failure);
      }
    }
    this.emit({ kind: 'updated', entry });
  }

  private append(
    entry: AssistantEntry,
    type: 'text' | 'reasoning',
    text: string
  ) {
    if (!text) return;
    const last = entry.parts[entry.parts.length - 1];
    if (last?.type === type) last.text += text;
    else entry.parts.push({ type, text });
  }

  /** The reply's part for tool call `id`, added when it is new. */
  private tool(entry: AssistantEntry, id: string, name: string): ToolPart {
    for (const part of entry.parts) {
      if (part.type === 'tool' && part.id === id) return part;
    }
    const part: ToolPart = {
      type: 'tool',
      id,
      name,
      input: undefined,
      state: 'running',
    };
    entry.parts.push(part);
    return part;
  }
}
