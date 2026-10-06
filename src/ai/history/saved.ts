/**
 * A conversation as it is kept on disk: what the panel showed, what the
 * model was sent and what became of the assistant's edits, as JSON. The
 * images in it are kept as files of their own beside it and named in the
 * JSON by their id, so a conversation reads back without them where they
 * are gone.
 */

import type { ModelMessage } from 'ai';
import type {
  AssistantEntry,
  ChatEntry,
  ChatPart,
  ToolPart,
} from '../agent/session';
import { type ChatImage, imageType } from '../images/image';

export const CONVERSATION_VERSION = 1;

/** The longest title kept, from the start of the first message. */
const TITLE_MAX = 80;

export type Conversation = {
  title: string;
  createdAt: number;
  updatedAt: number;
  entries: ChatEntry[];
  /** What the model is sent, as the conversation goes on. */
  messages: ModelMessage[];
  /** What the edit controller keeps of the conversation's edits. */
  edits: unknown;
};

/** An image's place in the JSON; null when it could not be kept. */
type ImageRef = { $image: string | null };

/** What goes in place of a model's image that is no longer kept. */
const GONE_IMAGE = '[An image that is no longer kept.]';

/** The conversation's title: the start of what the user first asked. */
export function conversationTitle(entries: readonly ChatEntry[]): string {
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    const text = entry.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    return text.length > TITLE_MAX
      ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : text;
  }
  return '';
}

/**
 * A copy of `value` for JSON, each run of bytes in it set apart in `images`
 * with the reference that stands for it. Runs at once, so what is kept is
 * the conversation as it was when asked.
 */
function setApart(
  value: unknown,
  images: Array<{ bytes: Uint8Array; ref: ImageRef }>
): unknown {
  if (value instanceof Uint8Array) {
    const ref: ImageRef = { $image: null };
    images.push({ bytes: value, ref });
    return ref;
  }
  if (Array.isArray(value)) return value.map((item) => setApart(item, images));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === 'function') continue;
      copy[key] = setApart(item, images);
    }
    return copy;
  }
  return value;
}

/** Keeps an image and gives its id, or null when it cannot. */
export type SaveImage = (
  bytes: Uint8Array,
  mime: string
) => Promise<string | null>;

/**
 * The conversation as JSON, as it is now, with its images still to keep:
 * the function returned keeps them with `save` and gives the JSON. An
 * image it cannot keep reads back as gone.
 */
export function packConversation(
  conversation: Conversation
): (save: SaveImage) => Promise<Record<string, unknown>> {
  const images: Array<{ bytes: Uint8Array; ref: ImageRef }> = [];
  const packed = setApart(
    {
      version: CONVERSATION_VERSION,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      // `messages` is what the list of conversations counts.
      messages: conversation.entries,
      history: conversation.messages,
      edits: conversation.edits,
    },
    images
  ) as Record<string, unknown>;
  return async (save) => {
    for (const { bytes, ref } of images) {
      const mime = imageType(bytes);
      if (!mime) continue;
      try {
        ref.$image = await save(bytes, mime);
      } catch {
        ref.$image = null;
      }
    }
    return packed;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const isImageRef = (value: unknown): value is ImageRef =>
  isRecord(value) &&
  '$image' in value &&
  (typeof value.$image === 'string' || value.$image === null);

/** Stands for a value that held an image no longer kept. */
const GONE = Symbol('gone');

function imageIds(value: unknown, ids: Set<string>) {
  if (isImageRef(value)) {
    if (value.$image) ids.add(value.$image);
  } else if (Array.isArray(value)) {
    for (const item of value) imageIds(item, ids);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) imageIds(item, ids);
  }
}

/**
 * `value` with its images read back. What held an image that is gone goes
 * too: from a list, an image is left out and a model's image part becomes
 * a note that it is gone; elsewhere the field that held it.
 */
function putBack(
  value: unknown,
  images: ReadonlyMap<string, Uint8Array>
): unknown {
  if (isImageRef(value)) {
    return (value.$image && images.get(value.$image)) || GONE;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const back = putBack(item, images);
      if (back !== GONE) items.push(back);
      else if (isRecord(item) && item.type === 'file') {
        items.push({ type: 'text', text: GONE_IMAGE });
      }
    }
    return items;
  }
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const back = putBack(item, images);
      // An image, or a model's data part, is nothing without its bytes.
      if (back === GONE && key === 'data') return GONE;
      if (back !== GONE) copy[key] = back;
    }
    return copy;
  }
  return value;
}

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const TOOL_STATES = new Set(['running', 'done', 'denied', 'error', 'stopped']);
const STATUSES = new Set(['streaming', 'done', 'stopped', 'error']);

function chatImage(value: unknown): ChatImage | null {
  if (!isRecord(value) || !(value.data instanceof Uint8Array)) return null;
  const { name, mediaType, width, height } = value;
  if (typeof mediaType !== 'string') return null;
  return {
    name: typeof name === 'string' ? name : '',
    mediaType,
    data: value.data,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
  };
}

function chatPart(value: unknown): ChatPart | null {
  if (!isRecord(value)) return null;
  if (value.type === 'text' || value.type === 'reasoning') {
    return typeof value.text === 'string'
      ? { type: value.type, text: value.text }
      : null;
  }
  if (value.type !== 'tool') return null;
  const { id, name, state } = value;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return {
    type: 'tool',
    id,
    name,
    input: value.input,
    // A call cut off when the conversation was kept went no further.
    state:
      typeof state === 'string' && TOOL_STATES.has(state) && state !== 'running'
        ? (state as ToolPart['state'])
        : 'stopped',
    ...('output' in value ? { output: value.output } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

function chatEntry(value: unknown, messages: number): ChatEntry | null {
  if (!isRecord(value) || typeof value.id !== 'number') return null;
  if (value.role === 'user') {
    if (typeof value.text !== 'string') return null;
    const images: ChatImage[] = [];
    for (const item of Array.isArray(value.images) ? value.images : []) {
      const image = chatImage(item);
      if (image) images.push(image);
    }
    return { id: value.id, role: 'user', text: value.text, images };
  }
  if (value.role !== 'assistant' || !Array.isArray(value.parts)) return null;
  const parts: ChatPart[] = [];
  for (const item of value.parts) {
    const part = chatPart(item);
    if (part) parts.push(part);
  }
  const status =
    typeof value.status === 'string' && STATUSES.has(value.status)
      ? (value.status as AssistantEntry['status'])
      : 'stopped';
  const start = typeof value.historyStart === 'number' ? value.historyStart : 0;
  const entry: AssistantEntry = {
    id: value.id,
    role: 'assistant',
    parts,
    status: status === 'streaming' ? 'stopped' : status,
    model: typeof value.model === 'string' ? value.model : '',
    historyStart: Math.max(0, Math.min(messages, Math.floor(start))),
  };
  if (isRecord(value.error) && typeof value.error.code === 'string') {
    entry.error = value.error as AssistantEntry['error'];
  }
  if (isRecord(value.usage))
    entry.usage = value.usage as AssistantEntry['usage'];
  if (
    value.ending === 'step-limit' ||
    value.ending === 'length' ||
    value.ending === 'filtered'
  ) {
    entry.ending = value.ending;
  }
  return entry;
}

/**
 * A kept conversation as it was, its images read back with `read`, which
 * gives null for one that is gone. Null for what is no conversation.
 */
export async function unpackConversation(
  value: unknown,
  read: (image: string) => Promise<Uint8Array | null>
): Promise<Conversation | null> {
  if (!isRecord(value) || typeof value.version !== 'number') return null;
  if (value.version > CONVERSATION_VERSION) return null;
  const ids = new Set<string>();
  imageIds(value, ids);
  const images = new Map<string, Uint8Array>();
  for (const id of ids) {
    const bytes = await read(id).catch(() => null);
    if (bytes && bytes.length > 0) images.set(id, bytes);
  }
  const back = putBack(value, images) as Record<string, unknown>;

  const messages: ModelMessage[] = [];
  for (const message of Array.isArray(back.history) ? back.history : []) {
    if (!isRecord(message) || typeof message.role !== 'string') return null;
    if (!ROLES.has(message.role)) return null;
    messages.push(message as ModelMessage);
  }
  const entries: ChatEntry[] = [];
  for (const item of Array.isArray(back.messages) ? back.messages : []) {
    const entry = chatEntry(item, messages.length);
    if (entry) entries.push(entry);
  }
  const number = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) ? field : 0;
  return {
    title: typeof back.title === 'string' ? back.title : '',
    createdAt: number(back.createdAt),
    updatedAt: number(back.updatedAt),
    entries,
    messages,
    edits: back.edits ?? null,
  };
}
