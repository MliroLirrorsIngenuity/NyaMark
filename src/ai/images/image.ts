/**
 * Images the assistant is shown: what a message carries, and the limits
 * they are brought within before they are sent. Each service takes images
 * of its own sizes; within these, every one of them takes it whole.
 */

import type { FilePart, ModelMessage } from 'ai';

export type ChatImage = {
  /** The file's name, or what the image is called where it came from. */
  name: string;
  mediaType: string;
  data: Uint8Array;
  width: number;
  height: number;
};

/**
 * The longest side sent. Services scale larger images down to about this
 * themselves, after charging for the upload.
 */
export const MAX_IMAGE_SIDE = 1568;
/** The most bytes sent for one image: 5 MB once Base64 encoded. */
export const MAX_IMAGE_BYTES = 3_750_000;
/** The most images one message carries. */
export const MAX_IMAGES = 10;
/** Larger than this, an image is not worth reading to scale down. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export type ImageErrorCode = 'too-large' | 'not-an-image';

export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code);
  }
}

/** The image type the bytes start like; the name may say anything. */
export function imageType(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const ascii = (text: string, at = 0) =>
    [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png';
  }
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii('GIF87a') || ascii('GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii('RIFF') && ascii('WEBP', 8)) {
    return 'image/webp';
  }
  if (bytes.length >= 26 && ascii('BM')) return 'image/bmp';
  return null;
}

/** Whether a service takes the type as it is: animation and BMP it may not. */
export function isSendableType(type: string | null): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp';
}

/** A size within `max` on its longer side, in the same proportions. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_IMAGE_SIDE
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function imagePart(image: ChatImage): FilePart {
  return {
    type: 'file',
    mediaType: image.mediaType,
    filename: image.name,
    data: { type: 'data', data: image.data },
  };
}

/** A user's message: the images first, as the services advise, then the words. */
export function userMessage(
  text: string,
  images: readonly ChatImage[] = []
): ModelMessage {
  if (images.length === 0) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      ...images.map(imagePart),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ],
  };
}
