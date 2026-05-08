import {
  defaultImageSettings,
  type ImageInsertPolicy,
  type PastedImagePolicy,
} from '../state/image-settings';

export type InsertRule =
  | { mode: 'use-path' }
  | { mode: 'copy'; targetDir: string }
  | { mode: 'base64' };

export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function isImagePath(path: string) {
  return /\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|tiff|webp)$/i.test(path);
}

export function defaultPastedImageName(file: File) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const extension = file.type.split('/')[1] || 'png';
  return `image-${stamp}.${extension}`;
}

export function getDocumentCopyTarget(markdown: string) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!frontmatter) return null;

  for (const key of ['typora-copy-images-to', 'nyamark-copy-images-to']) {
    const match = frontmatter[1].match(
      new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm')
    );
    if (match?.[1]) {
      return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return null;
}

export function policyToInsertRule(
  policy: ImageInsertPolicy | PastedImagePolicy,
  customDirectory: string | null
): InsertRule {
  switch (policy) {
    case 'copy-same-folder':
      return { mode: 'copy', targetDir: '.' };
    case 'copy-assets':
      return { mode: 'copy', targetDir: './assets' };
    case 'copy-custom-folder':
      return customDirectory
        ? { mode: 'copy', targetDir: customDirectory }
        : defaultImageSettings.insertPolicy === 'use-path'
          ? { mode: 'use-path' }
          : { mode: 'copy', targetDir: './assets' };
    case 'base64':
      return { mode: 'base64' };
    default:
      return { mode: 'use-path' };
  }
}

export function extractClipboardFilePaths(clipboard: DataTransfer) {
  const payloads = [
    clipboard.getData('text/uri-list'),
    clipboard.getData('text/plain'),
  ];

  return Array.from(
    new Set(payloads.flatMap((payload) => parseFileUris(payload)))
  );
}

export function isExternalResource(value: string) {
  return (
    !/^[a-zA-Z]:[\\/]/.test(value) &&
    /^(https?:|data:|blob:|asset:|mailto:|tel:)/i.test(value)
  );
}

function parseFileUris(payload: string) {
  if (!payload) return [];

  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .map((line) => fileUriToPath(line))
    .filter((line): line is string => Boolean(line));
}

function fileUriToPath(uri: string) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;

    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1);
    }
    return path;
  } catch {
    return null;
  }
}
