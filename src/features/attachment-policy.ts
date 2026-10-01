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

export const IMAGE_EXTENSIONS = [
  'avif',
  'bmp',
  'gif',
  'heic',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tiff',
  'webp',
] as const;

const IMAGE_PATH_PATTERN = new RegExp(
  `\\.(${IMAGE_EXTENSIONS.join('|')})$`,
  'i'
);

export function isImagePath(path: string) {
  return IMAGE_PATH_PATTERN.test(path);
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

/**
 * Local files on the clipboard, as paths. `text/uri-list` is meant for exactly
 * this. Plain text only counts when it is nothing but `file://` lines (some
 * file managers put the list there); prose that merely mentions a file URI
 * stays an ordinary text paste.
 */
export function extractClipboardFilePaths(
  clipboard: Pick<DataTransfer, 'getData'>
) {
  const uriList = parseFileUris(clipboard.getData('text/uri-list'), {
    requireAll: false,
  });
  const plainText = parseFileUris(clipboard.getData('text/plain'), {
    requireAll: true,
  });
  return Array.from(new Set([...uriList, ...plainText]));
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
  // A reference written with `%20` (or the old `\ `) stays encoded even when
  // the settings leave spaces alone.
  const encoded = decoded !== value;
  const absolutePath = resolveAttachmentPath(fromDocument, value);
  if (!absolutePath) return null;

  const next = formatAttachmentReference(toDocument, absolutePath, {
    ...options,
    preferRelativePath: options.preferRelativePath || wasRelative,
    escapePath: options.escapePath || encoded,
  });
  return next === value ? null : next;
}

function parseFileUris(
  payload: string,
  { requireAll }: { requireAll: boolean }
) {
  if (!payload) return [];

  // RFC 2483: lines starting with `#` are comments.
  const lines = payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const fileLines = lines.filter((line) => /^file:\/\//i.test(line));
  if (requireAll && fileLines.length !== lines.length) return [];

  return fileLines
    .map((line) => fileUriToPath(line))
    .filter((line): line is string => Boolean(line));
}
