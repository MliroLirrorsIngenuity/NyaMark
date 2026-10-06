/**
 * The tool the assistant looks at images with: one the document shows, or
 * a file on this computer. The app reads the file, only from where the
 * document's own links may reach, and brings it within what the services
 * take. Tool results carry only text through some services' APIs, so the
 * image itself reaches the model in a message from the app after the step.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  ImageReadError,
  type ImageReadFailure,
  type InvokeFailure,
} from '../../../bridge/ipc/ai';
import {
  type ChatImage,
  ImageError,
  type ImageErrorCode,
  MAX_IMAGES,
} from '../../images/image';

export type ImageHost = {
  /** The file an image reference names, or null when it names none here. */
  resolve(src: string): Promise<string | null>;
  read(path: string): Promise<Uint8Array>;
  prepare(source: Blob | Uint8Array, name: string): Promise<ChatImage>;
  /** Has the model see the images before its next step. */
  show(caption: string, images: ChatImage[]): void;
};

export type ViewImageOutput = {
  text: string;
  src: string;
  /** The image as it was sent, for the panel to show. */
  image?: ChatImage;
};

/** Why an image could not be opened. */
type Failure =
  | ImageReadFailure
  | InvokeFailure
  | { kind: ImageErrorCode }
  | { kind: 'remote' | 'unsupported' | 'no-file' | 'too-many' };

/** What each failure means, for the assistant. */
const EXPLAINED: Record<Failure['kind'], string> = {
  remote:
    'The image is on the web. view_image opens images saved on this computer; work from its alt text, or ask the user to save it beside the document.',
  unsupported: 'That address names no image file. Give a path or a data URL.',
  'no-file':
    'A relative path needs the document to be saved first. Give a full path, or ask the user to save the document.',
  forbidden:
    "The image is outside the folders the app may read: the document's folder, folders the user added, and files the user opened. Ask the user to open or drop it.",
  'not-found': 'There is no file at that path.',
  'too-large': 'The image is too large to send.',
  'not-an-image': 'The file is no image the app can read.',
  'too-many': `You have opened ${MAX_IMAGES} images this turn; that is the most one turn may open. Work from those, or ask the user to send the one you need.`,
  io: 'The file could not be read.',
  invoke: 'The app could not read the file.',
};

function failure(kind: Failure['kind'], detail = ''): Error {
  return new Error(
    `${kind}: ${EXPLAINED[kind]}${detail ? ` (${detail.slice(0, 300)})` : ''}`
  );
}

/** An error told so the assistant can act. */
function explain(error: unknown): Error {
  if (error instanceof ImageError) return failure(error.code);
  if (error instanceof ImageReadError) {
    const read = error.failure;
    return failure(read.kind, 'message' in read ? read.message : '');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A data URL's bytes, typed as it says, decoded the way fetch does. */
export async function dataUrlBlob(src: string): Promise<Blob | null> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'data:') return null;
  try {
    const response = await fetch(url.href);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function imageTools(host: ImageHost) {
  // Each image goes into every step after it, so a turn opens only so many.
  const opened = new Set<string>();

  const load = async (src: string) => {
    if (/^data:/i.test(src)) {
      const blob = await dataUrlBlob(src);
      if (!blob) throw failure('not-an-image');
      return { key: src, image: await host.prepare(blob, 'image') };
    }
    if (/^https?:/i.test(src)) throw failure('remote', src);
    // A Windows drive letter starts a path; any other scheme names no file.
    const scheme = /^[a-z][a-z0-9+.-]*:/i.test(src);
    if (scheme && !/^file:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) {
      throw failure('unsupported', src);
    }
    const path = await host.resolve(src);
    if (!path) throw failure('no-file', src);
    if (opened.has(path)) return { key: path, image: null };
    const bytes = await host.read(path);
    return { key: path, image: await host.prepare(bytes, fileName(path)) };
  };

  return {
    view_image: tool({
      description:
        "Look at an image: one the document shows, or a file on this computer. A relative path is taken from the document's folder, as the document's own image links are. Images on the web cannot be opened.",
      inputSchema: z.object({
        src: z
          .string()
          .min(1)
          .describe(
            'The image as the document gives it: the path or data URL in ![alt](…) or <img src="…">, or a full path on this computer.'
          ),
      }),
      execute: async ({ src }): Promise<ViewImageOutput> => {
        const trimmed = src.trim();
        if (opened.size >= MAX_IMAGES) throw failure('too-many');
        let loaded: Awaited<ReturnType<typeof load>>;
        try {
          loaded = await load(trimmed);
        } catch (error) {
          throw explain(error);
        }
        const { key, image } = loaded;
        if (!image) {
          return {
            text: `You opened ${trimmed} earlier this turn; the image is in the messages above.`,
            src: trimmed,
          };
        }
        opened.add(key);
        host.show(
          `The image view_image opened from ${trimmed}. This message is from the app, not the user.`,
          [image]
        );
        return {
          text: `Opened ${trimmed} (${image.width}×${image.height}). The image follows in a message from the app.`,
          src: trimmed,
          image,
        };
      },
      toModelOutput: ({ output }) => ({ type: 'text', value: output.text }),
    }),
  };
}
