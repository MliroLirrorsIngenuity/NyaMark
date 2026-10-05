/**
 * Keeps the panel's conversation for the document as it goes: when the
 * user sends a message, when a reply is over, and shortly after the edits
 * change. Opens a kept one in its place, and the latest when the panel
 * first opens.
 */

import type { ConversationSummary } from '../../bridge/ipc/ai';
import type { ChatSession, SessionChange } from '../agent/session';
import type { EditController } from '../edit/controller';
import {
  type SaveImage,
  conversationTitle,
  packConversation,
  unpackConversation,
} from './saved';
import { type ConversationStore, conversationStore } from './store';

export type KeeperHost = {
  session: ChatSession;
  edits: EditController;
  documentPath: () => string | null;
  /** Whether conversations are kept at all. */
  enabled: () => boolean;
  /** The conversation shown was put away for another, or for none. */
  switched: () => void;
  /** Where conversations are kept; the window's own unless given. */
  store?: ConversationStore;
};

/** How long the edits settle before what became of them is kept. */
const EDITS_DELAY = 1500;

function newId() {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `c${Date.now().toString(36)}${random}`;
}

export class ConversationKeeper {
  private id = newId();
  private createdAt = Date.now();
  private updatedAt = Date.now();
  /** The edits as last kept, to skip keeping them again unchanged. */
  private keptEdits = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Counts the conversations opened, to drop one overtaken by another. */
  private opening = 0;
  /** Images kept for the conversation, by their bytes. */
  private images = new WeakMap<Uint8Array, string>();
  private imagesFor = '';
  private readonly cleanups: Array<() => void> = [];
  private readonly store: ConversationStore;

  constructor(private readonly host: KeeperHost) {
    this.store = host.store ?? conversationStore();
    this.store.track(host.documentPath());
    this.cleanups.push(
      host.session.subscribe((change) => this.sessionChanged(change)),
      host.edits.subscribe(() => this.editsChanged()),
      this.store.onCleared(() => this.discard())
    );
  }

  /** The id of the conversation shown. */
  get current(): string {
    return this.id;
  }

  destroy() {
    this.flush();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  /** Keeps what is waiting to be kept, now. */
  flush() {
    if (this.timer == null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.keep(false);
  }

  list(): Promise<ConversationSummary[]> {
    return this.store.list();
  }

  /** Opens the latest kept conversation, while none has been started. */
  async openLatest() {
    if (!this.host.enabled()) return;
    const opening = this.opening;
    const latest = (await this.store.list().catch(() => []))[0];
    if (!latest || opening !== this.opening || !this.untouched()) return;
    await this.open(latest.id, true).catch((error: unknown) => {
      console.warn('Failed to open the last conversation:', error);
    });
  }

  /**
   * Opens kept conversation `id` in place of the one shown. Throws when it
   * cannot be read; false when another was opened meanwhile, or, for the
   * latest, when the user started one.
   */
  async open(id: string, latest = false): Promise<boolean> {
    if (id === this.id && this.host.session.entries.length > 0) return true;
    this.flush();
    const opening = ++this.opening;
    const generation = this.store.generation;
    const found = new Map<Uint8Array, string>();
    const conversation = await this.store.read(id, (value, read) =>
      unpackConversation(value, async (image) => {
        const bytes = await read(image);
        if (bytes) found.set(bytes, image);
        return bytes;
      })
    );
    if (opening !== this.opening || (latest && !this.untouched())) {
      return false;
    }
    if (!conversation) throw new Error(`corrupt: ${id}`);
    this.cancel();
    this.id = id;
    this.createdAt = conversation.createdAt || Date.now();
    this.updatedAt = conversation.updatedAt || this.createdAt;
    this.keptEdits = JSON.stringify(conversation.edits ?? null);
    this.images = new WeakMap(found);
    this.imagesFor = `${generation}:${id}`;
    this.host.session.restore(conversation.entries, conversation.messages);
    this.host.switched();
    await this.host.edits.restore(conversation.edits);
    return true;
  }

  /** Puts the conversation shown away, kept, and starts a new one. */
  startNew() {
    this.flush();
    this.opening++;
    this.fresh();
  }

  /** Deletes kept conversation `id`; the one shown starts over. */
  async remove(id: string) {
    if (id === this.id) {
      this.opening++;
      this.fresh();
    }
    await this.store.delete(id);
  }

  /** The panel has nothing of its own yet: the latest may take its place. */
  private untouched() {
    const { session } = this.host;
    return session.entries.length === 0 && !session.busy;
  }

  /** A new conversation in place of the one shown, which is not kept. */
  private fresh() {
    this.cancel();
    this.id = newId();
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.keptEdits = '';
    this.host.session.clear();
    this.host.edits.reset();
    this.host.switched();
  }

  /** Every conversation was deleted, the one shown with them. */
  private discard() {
    this.opening++;
    this.fresh();
  }

  private cancel() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  private sessionChanged(change: SessionChange) {
    // A reset is a conversation started or opened, by this keeper.
    if (change.kind === 'reset') return;
    const { entry } = change;
    if (
      change.kind === 'updated' &&
      (entry.role !== 'assistant' || entry.status === 'streaming')
    ) {
      return;
    }
    // The reply begun is kept once it is over.
    if (change.kind === 'added' && entry.role === 'assistant') return;
    this.cancel();
    this.keep(true);
  }

  private editsChanged() {
    if (this.host.session.entries.length === 0) return;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.keep(false);
    }, EDITS_DELAY);
  }

  /** Keeps the conversation as it is now; `talked` when its messages grew. */
  private keep(talked: boolean) {
    if (!this.host.enabled()) return;
    const { entries, messages } = this.host.session.saved();
    if (entries.length === 0) return;
    const edits = this.host.edits.save();
    const editsJson = JSON.stringify(edits);
    if (!talked && editsJson === this.keptEdits) return;
    this.keptEdits = editsJson;
    if (talked) this.updatedAt = Date.now();
    const id = this.id;
    const pack = packConversation({
      title: conversationTitle(entries),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      entries,
      messages,
      edits,
    });
    this.store
      .write(id, (save) => pack(this.cachedSave(id, save)))
      .catch((error: unknown) => {
        console.warn('Failed to keep the conversation:', error);
      });
  }

  /** `save`, skipping the images this conversation has kept already. */
  private cachedSave(id: string, save: SaveImage): SaveImage {
    return async (bytes, mime) => {
      const key = `${this.store.generation}:${id}`;
      if (key !== this.imagesFor) {
        this.images = new WeakMap();
        this.imagesFor = key;
      }
      const known = this.images.get(bytes);
      if (known) return known;
      const image = await save(bytes, mime);
      if (image) this.images.set(bytes, image);
      return image;
    };
  }
}
