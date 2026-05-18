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

export function escapeMarkdownPath(path: string) {
  return path.replace(/ /g, '\\ ');
}

export function unescapeMarkdownPath(path: string) {
  return path.replace(/\\ /g, ' ');
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

export function resolveStorageDir(documentPath: string, targetDir: string) {
  const normalizedTarget = targetDir.trim();
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

  const unescaped = normalizePath(unescapeMarkdownPath(trimmed));
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

  return options.escapePath ? escapeMarkdownPath(reference) : reference;
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
