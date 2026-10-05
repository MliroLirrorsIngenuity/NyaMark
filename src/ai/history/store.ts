/**
 * The window's saved conversations, kept for its document. Every call waits
 * for the ones before it, so a conversation is never written to where its
 * document was, after the conversations went along to where it is now.
 */

import {
  type ConversationSummary,
  clearConversations,
  deleteConversation,
  listConversations,
  moveConversations,
  readConversation,
  readConversationImage,
  saveConversationImage,
  writeConversation,
} from '../../bridge/ipc/ai';
import type { SaveImage } from './saved';

/** Where conversations are kept; `document` is null for a draft's. */
export type HistoryApi = {
  list(document: string | null): Promise<ConversationSummary[]>;
  read(document: string | null, id: string): Promise<unknown>;
  write(document: string | null, id: string, value: unknown): Promise<void>;
  delete(document: string | null, id: string): Promise<void>;
  move(from: string | null, to: string | null): Promise<void>;
  clear(): Promise<void>;
  saveImage(
    document: string | null,
    id: string,
    bytes: Uint8Array,
    mime: string
  ): Promise<string>;
  readImage(
    document: string | null,
    id: string,
    image: string
  ): Promise<Uint8Array>;
};

const IPC: HistoryApi = {
  list: listConversations,
  read: readConversation,
  write: writeConversation,
  delete: deleteConversation,
  move: moveConversations,
  clear: clearConversations,
  saveImage: saveConversationImage,
  readImage: readConversationImage,
};

export class ConversationStore {
  private tail: Promise<unknown> = Promise.resolve();
  /** The document the conversations are kept for; null for a draft. */
  private document: string | null | undefined;
  private changes = 0;
  private readonly clearListeners = new Set<() => void>();

  constructor(private readonly api: HistoryApi) {}

  /** The window's document, as known before it was first saved or moved. */
  track(path: string | null) {
    if (this.document === undefined) this.document = path;
  }

  /** The window's document moved to `to`, and its conversations go along. */
  documentMoved(from: string | null, to: string | null): Promise<void> {
    if (from === to) return Promise.resolve();
    return this.queued(async () => {
      try {
        await this.api.move(from, to);
      } finally {
        this.document = to;
        this.changes++;
      }
    });
  }

  /**
   * Counts what changed where images are kept: a move, or every
   * conversation deleted. An image's id from before may not hold since.
   */
  get generation(): number {
    return this.changes;
  }

  /** Told once every conversation is deleted. Returns the unsubscribe. */
  onCleared(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return () => {
      this.clearListeners.delete(listener);
    };
  }

  list(): Promise<ConversationSummary[]> {
    return this.queued((document) => this.api.list(document));
  }

  /**
   * Writes conversation `id`, made by `pack` when its turn comes; `save`
   * keeps one of its images and gives the image's id.
   */
  write(id: string, pack: (save: SaveImage) => Promise<unknown>) {
    return this.queued(async (document) => {
      const value = await pack((bytes, mime) =>
        this.api.saveImage(document, id, bytes, mime)
      );
      await this.api.write(document, id, value);
    });
  }

  /**
   * Reads conversation `id` and, with `unpack`, its images, in one turn so
   * they come from the same place. An image that is gone reads as null.
   */
  read<T>(
    id: string,
    unpack: (
      value: unknown,
      image: (image: string) => Promise<Uint8Array | null>
    ) => Promise<T>
  ): Promise<T> {
    return this.queued(async (document) => {
      const value = await this.api.read(document, id);
      return await unpack(value, (image) =>
        this.api.readImage(document, id, image).catch(() => null)
      );
    });
  }

  delete(id: string): Promise<void> {
    return this.queued((document) => this.api.delete(document, id));
  }

  /** Deletes every conversation, of every document. */
  clear(): Promise<void> {
    return this.queued(async () => {
      try {
        await this.api.clear();
      } finally {
        this.changes++;
        for (const listener of this.clearListeners) listener();
      }
    });
  }

  /** Runs `task` once the calls before it are done, for the document then. */
  private queued<T>(task: (document: string | null) => Promise<T>) {
    const run = () => task(this.document ?? null);
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

let store: ConversationStore | null = null;

/** This window's conversations. */
export function conversationStore(): ConversationStore {
  store ??= new ConversationStore(IPC);
  return store;
}
