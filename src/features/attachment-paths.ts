export type AttachmentReferenceOptions = {
  preferRelativePath: boolean;
  ensureDotSlash: boolean;
  escapePath: boolean;
};

type PathRoot = {
  prefix: string;
  absolute: boolean;
};

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, '/');
}

export function isAbsolutePath(path: string) {
  return /^(?:[A-Za-z]:\/|\/)/.test(normalizePathSeparators(path));
}

export function basenamePath(path: string) {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized;
}

export function dirnamePath(path: string) {
  const normalized = normalizePath(path);
  const root = parseRoot(normalized);
  const parts = pathParts(normalized);
  if (parts.length <= 1) {
    if (root.absolute) {
      return root.prefix === '/' ? '/' : `${root.prefix}/`;
    }
    return '.';
  }

  const parent = parts.slice(0, -1).join('/');
  return joinRoot(root, parent);
}

export function normalizePath(path: string) {
  const normalized = normalizePathSeparators(path).trim();
  const root = parseRoot(normalized);
  const parts: string[] = [];

  for (const part of normalized.slice(root.prefix.length).split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!root.absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join('/');
  if (!joined) {
    if (root.absolute) {
      return root.prefix === '/' ? '/' : `${root.prefix}/`;
    }
    return '.';
  }

  return joinRoot(root, joined);
}

/**
 * Older versions wrote spaces as `\ `, which CommonMark reads as a literal
 * backslash. Reading the form back keeps those documents resolving.
 */
export function unescapeMarkdownPath(path: string) {
  return path.replace(/\\ /g, ' ');
}

/**
 * Markdown link destinations are URLs, so a space or a non-ASCII character
 * often arrives as `%20` or `%E4%B8%AD`. A `%` that starts no escape (a
 * literal `100%.png`) leaves the value untouched.
 */
export function decodeMarkdownPath(reference: string) {
  if (!/%[0-9A-Fa-f]{2}/.test(reference)) return reference;
  try {
    return decodeURIComponent(reference);
  } catch {
    return reference;
  }
}

/**
 * The inverse of `decodeMarkdownPath` for the characters it is used for. This
 * is what `escapePath` writes: CommonMark has no escape for a space inside a
 * link destination, while `%20` reads back in every renderer and browser.
 */
export function percentEncodeMarkdownPath(path: string) {
  return path.replace(/%/g, '%25').replace(/ /g, '%20');
}

/**
 * Local path behind a `file:` URI, or `null` for anything else. A host other
 * than `localhost` names a Windows share, so the result is a UNC path.
 */
export function fileUriToPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;

    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1);
    }
    const host = url.hostname;
    return host && host !== 'localhost' ? `//${host}${path}` : path;
  } catch {
    return null;
  }
}

export function looksLikeExternalResource(value: string) {
  return /^(?:https?:|data:|blob:|asset:|mailto:|tel:)/i.test(value);
}

export function sanitizeFileName(fileName: string) {
  const rawName = basenamePath(fileName) || 'attachment';
  const dot = rawName.lastIndexOf('.');
  const stem = dot > 0 ? rawName.slice(0, dot) : rawName;
  const ext = dot > 0 ? rawName.slice(dot + 1) : '';
  const sanitizedStem = Array.from(stem)
    .map((ch) => (/[\p{Letter}\p{Number}._-]/u.test(ch) ? ch : '-'))
    .join('')
    .replace(/^-+|-+$/g, '');
  const safeStem = sanitizedStem || 'attachment';

  return ext ? `${safeStem}.${ext}` : safeStem;
}

/**
 * `${filename}` in a target directory stands for the document's name without
 * its extension, as in Typora's `typora-copy-images-to`.
 */
export function expandStorageDirTemplate(
  targetDir: string,
  documentPath: string
) {
  const stem = basenamePath(documentPath).replace(/\.[^.]+$/, '');
  return targetDir.replace(/\$\{filename\}/g, stem);
}

export function resolveStorageDir(documentPath: string, targetDir: string) {
  const normalizedTarget = expandStorageDirTemplate(
    targetDir,
    documentPath
  ).trim();
  if (
    !normalizedTarget ||
    normalizedTarget === '.' ||
    normalizedTarget === './'
  ) {
    return dirnamePath(documentPath);
  }

  return isAbsolutePath(normalizedTarget)
    ? normalizePath(normalizedTarget)
    : joinPaths(dirnamePath(documentPath), normalizedTarget);
}

export function resolveAttachmentPath(
  documentPath: string | null,
  assetPath: string
) {
  const trimmed = assetPath.trim();
  if (!trimmed || looksLikeExternalResource(trimmed)) {
    return null;
  }

  if (/^file:/i.test(trimmed)) {
    const path = fileUriToPath(trimmed);
    return path ? normalizePath(path) : null;
  }

  const unescaped = normalizePath(
    decodeMarkdownPath(unescapeMarkdownPath(trimmed))
  );
  if (isAbsolutePath(unescaped)) {
    return unescaped;
  }

  if (!documentPath) {
    return null;
  }

  return joinPaths(dirnamePath(documentPath), unescaped);
}

export function formatAttachmentReference(
  documentPath: string | null,
  assetPath: string,
  options: AttachmentReferenceOptions
) {
  const trimmed = assetPath.trim();
  if (!trimmed || looksLikeExternalResource(trimmed)) {
    return trimmed;
  }

  const normalizedTarget = normalizePath(unescapeMarkdownPath(trimmed));
  const documentDir = documentPath ? dirnamePath(documentPath) : null;
  let reference = normalizedTarget;

  if (options.preferRelativePath && documentDir) {
    const relative = diffPaths(normalizedTarget, normalizePath(documentDir));
    if (relative && relative !== '.') {
      reference = relative;
    }
  }

  if (options.ensureDotSlash && isPlainRelativeReference(reference)) {
    reference = `./${reference}`;
  }

  return options.escapePath ? percentEncodeMarkdownPath(reference) : reference;
}

function joinPaths(base: string, child: string) {
  return normalizePath(`${normalizePath(base).replace(/\/+$/, '')}/${child}`);
}

function diffPaths(path: string, base: string) {
  const normalizedPath = normalizePath(path);
  const normalizedBase = normalizePath(base);
  const pathRoot = parseRoot(normalizedPath);
  const baseRoot = parseRoot(normalizedBase);

  if (
    pathRoot.absolute !== baseRoot.absolute ||
    pathRoot.prefix !== baseRoot.prefix
  ) {
    return null;
  }

  const pathPartsValue = pathParts(normalizedPath);
  const basePartsValue = pathParts(normalizedBase);
  let commonLength = 0;

  while (
    commonLength < pathPartsValue.length &&
    commonLength < basePartsValue.length &&
    pathPartsValue[commonLength] === basePartsValue[commonLength]
  ) {
    commonLength += 1;
  }

  const up = basePartsValue.slice(commonLength).map(() => '..');
  const down = pathPartsValue.slice(commonLength);
  const result = [...up, ...down].join('/');

  return result || '.';
}

function isPlainRelativeReference(reference: string) {
  return (
    !!reference &&
    !reference.startsWith('./') &&
    !reference.startsWith('../') &&
    !reference.startsWith('/') &&
    !reference.startsWith('\\') &&
    !/^[A-Za-z]:/.test(reference)
  );
}

function parseRoot(path: string): PathRoot {
  const normalized = normalizePathSeparators(path);
  const drive = normalized.match(/^[A-Za-z]:\//);
  if (drive) {
    return { prefix: drive[0].slice(0, -1), absolute: true };
  }
  // `//server/share` is the root of a Windows network share; collapsing its
  // leading slashes would turn it into a local path.
  const share = normalized.match(/^\/\/[^/]+\/[^/]+/);
  if (share) {
    return { prefix: share[0], absolute: true };
  }
  if (normalized.startsWith('/')) {
    return { prefix: '/', absolute: true };
  }
  return { prefix: '', absolute: false };
}

function pathParts(path: string) {
  const normalized = normalizePathSeparators(path);
  const root = parseRoot(normalized);
  return normalized.slice(root.prefix.length).split('/').filter(Boolean);
}

function joinRoot(root: PathRoot, path: string) {
  if (!root.absolute) {
    return path || '.';
  }
  if (root.prefix === '/') {
    return `/${path}`;
  }
  return `${root.prefix}/${path}`;
}
