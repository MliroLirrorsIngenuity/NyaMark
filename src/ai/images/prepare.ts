/**
 * Brings an image within what the services take: decoded by the page, and
 * drawn again smaller, or as PNG or JPEG, when it is too large or of a type
 * a service may refuse.
 */

import {
  type ChatImage,
  ImageError,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  MAX_SOURCE_BYTES,
  fitWithin,
  imageType,
  isSendableType,
} from './image';

/** JPEG quality for a redrawn image. */
const JPEG_QUALITY = 0.85;
/** Each try past the first draws the image this much smaller. */
const SHRINK = 0.75;
const TRIES = 4;

async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new ImageError('not-an-image');
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new ImageError('not-an-image');
  }
  return image;
}

function draw(
  image: HTMLImageElement,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg'
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('No canvas to draw on'));
  if (type === 'image/jpeg') {
    // JPEG has no transparency; what was clear reads as paper.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Drawing failed'))),
      type,
      JPEG_QUALITY
    );
  });
}

export async function prepareImage(
  source: Blob | Uint8Array,
  name: string
): Promise<ChatImage> {
  const size = source instanceof Blob ? source.size : source.byteLength;
  if (size > MAX_SOURCE_BYTES) throw new ImageError('too-large');
  const bytes =
    source instanceof Blob
      ? new Uint8Array(await source.arrayBuffer())
      : source;
  const type = imageType(bytes);
  // The page may read what the bytes do not name, such as HEIC or SVG.
  const fallback = source instanceof Blob ? source.type : '';
  const image = await decode(
    new Blob([bytes], {
      type: type ?? fallback,
    })
  );
  const { naturalWidth, naturalHeight } = image;
  if (
    type &&
    isSendableType(type) &&
    Math.max(naturalWidth, naturalHeight) <= MAX_IMAGE_SIDE &&
    bytes.byteLength <= MAX_IMAGE_BYTES
  ) {
    return {
      name,
      mediaType: type,
      data: bytes,
      width: naturalWidth,
      height: naturalHeight,
    };
  }
  let { width, height } = fitWithin(naturalWidth, naturalHeight);
  for (let attempt = 0; attempt < TRIES; attempt++) {
    // A photo stays JPEG; anything else tries PNG first, for its edges.
    const asJpeg = type === 'image/jpeg' || attempt > 0;
    const blob = await draw(
      image,
      width,
      height,
      asJpeg ? 'image/jpeg' : 'image/png'
    );
    if (blob.size <= MAX_IMAGE_BYTES) {
      return {
        name,
        mediaType: asJpeg ? 'image/jpeg' : 'image/png',
        data: new Uint8Array(await blob.arrayBuffer()),
        width,
        height,
      };
    }
    if (attempt > 0) {
      width = Math.max(1, Math.round(width * SHRINK));
      height = Math.max(1, Math.round(height * SHRINK));
    }
  }
  throw new ImageError('too-large');
}
