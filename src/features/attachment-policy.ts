import type {
  ImageInsertPolicy,
  PastedImagePolicy,
} from '../state/image-settings';
import {
  type AttachmentReferenceOptions,
  decodeMarkdownPath,
  fileUriToPath,
  formatAttachmentReference,
  isAbsolutePath,
  normalizePath,
  percentEncodeMarkdownPath,
  resolveAttachmentPath,
  unescapeMarkdownPath,
} from './attachment-paths';

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

/**
 * Turn a stored policy into what to do with an image. `copy-custom-folder`
 * needs a folder; without one the answer is `null` and the caller asks the
 * user for the folder, since copying somewhere the user never picked would
 * scatter images silently.
 */
export function policyToInsertRule(
  policy: ImageInsertPolicy | PastedImagePolicy,
  customDirectory: string | null
): InsertRule | null {
  switch (policy) {
    case 'copy-same-folder':
      return { mode: 'copy', targetDir: '.' };
    case 'copy-assets':
      return { mode: 'copy', targetDir: './assets' };
    case 'copy-custom-folder':
      return customDirectory
        ? { mode: 'copy', targetDir: customDirectory }
        : null;
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

export type LinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'local'; reference: string }
  | { kind: 'ignore' };

/**
 * Decide what a clicked `href` may open. Only the schemes the opener plugin's
 * default scope accepts go to the OS; `file:` URIs become local paths; every
 * other scheme (`javascript:`, `data:`, `blob:`, custom handlers) is dropped
 * rather than handed to the system. Scheme-less values are document-relative
 * or absolute paths.
 */
export function classifyLinkTarget(href: string): LinkTarget {
  const value = href.trim();
  if (!value) return { kind: 'ignore' };

  if (/^(https?|mailto|tel):/i.test(value)) {
    return { kind: 'url', url: value };
  }

  if (/^file:/i.test(value)) {
    const path = fileUriToPath(value);
    return path ? { kind: 'local', reference: path } : { kind: 'ignore' };
  }

  // A Windows drive letter looks like a scheme; anything else with one is not
  // something the OS should be asked to open.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-zA-Z]:[\\/]/.test(value)) {
    return { kind: 'ignore' };
  }

  return { kind: 'local', reference: value };
}

/**
 * The reference a document at `fromDocument` holds, rewritten for the same
 * document living at `toDocument`. Returns `null` when nothing changes.
 *
 * A relative reference is anchored at the old directory and would break after
 * the move, so it is always re-expressed relative to the new one (absolute
 * when no relative form exists, such as across Windows drives). An absolute
 * reference keeps working wherever the document goes; it only turns relative
 * when the settings prefer that, which is how a document saved for the first
 * time sheds the absolute paths its images were inserted with.
 */
export function relocateLocalReference(
  reference: string,
  fromDocument: string | null,
  toDocument: string,
  options: AttachmentReferenceOptions
): string | null {
  const value = reference.trim();
  // Fragments and queries point into the document itself.
  if (!value || value.startsWith('#') || value.startsWith('?')) return null;
  // `file:` URIs are absolute by construction and stay in that form.
  if (/^file:/i.test(value)) return null;
  if (classifyLinkTarget(value).kind !== 'local') return null;

  const decoded = decodeMarkdownPath(unescapeMarkdownPath(value));
  const wasRelative = !isAbsolutePath(normalizePath(decoded));
  // A reference written with `%20` keeps that style rather than switching
  // to the backslash escape the settings may prefer.
  const percentEncoded = decoded !== value;
  const absolutePath = resolveAttachmentPath(fromDocument, value);
  if (!absolutePath) return null;

  let next = formatAttachmentReference(toDocument, absolutePath, {
    ...options,
    preferRelativePath: options.preferRelativePath || wasRelative,
    escapePath: options.escapePath && !percentEncoded,
  });
  if (percentEncoded) next = percentEncodeMarkdownPath(next);
  return next === value ? null : next;
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
