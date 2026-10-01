import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { copyFile, exists, writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  type AttachmentReferenceOptions,
  basenamePath,
  formatAttachmentReference,
  normalizePath,
  resolveAttachmentPath,
  resolveStorageDir,
  sanitizeFileName,
} from '../../features/attachment-paths';

export type { AttachmentReferenceOptions };

export type StoredAttachment = {
  markdownPath: string;
  absolutePath: string;
};

export async function storeAttachmentInDirectory(
  documentPath: string,
  targetDir: string,
  fileName: string,
  bytes: Uint8Array,
  options: AttachmentReferenceOptions
): Promise<StoredAttachment> {
  const storageDir = resolveStorageDir(documentPath, targetDir);
  await ensureAttachmentDirectory(storageDir);
  const targetPath = await createUniqueFile(
    storageDir,
    sanitizeFileName(fileName),
    bytes
  );
  return buildStoredAttachment(documentPath, targetPath, options);
}

export async function copyLocalAttachment(
  documentPath: string,
  sourcePath: string,
  targetDir: string,
  options: AttachmentReferenceOptions
): Promise<StoredAttachment> {
  const storageDir = resolveStorageDir(documentPath, targetDir);
  await ensureAttachmentDirectory(storageDir);

  // Checked before a name is claimed, so a missing or out-of-scope source
  // fails without leaving an empty placeholder behind.
  if (!(await exists(sourcePath))) {
    throw new Error(`No such file: ${sourcePath}`);
  }
  const fileName = basenamePath(sourcePath) || 'attachment';
  const targetPath = await createUniqueFile(
    storageDir,
    sanitizeFileName(fileName),
    new Uint8Array()
  );
  await copyFile(sourcePath, targetPath);

  return buildStoredAttachment(documentPath, targetPath, options);
}

export async function resolveDocumentAssetPath(
  documentPath: string | null,
  assetPath: string
): Promise<string | null> {
  return resolveAttachmentPath(documentPath, assetPath);
}

export async function formatMarkdownReference(
  documentPath: string | null,
  assetPath: string,
  options: AttachmentReferenceOptions
): Promise<string> {
  return formatAttachmentReference(documentPath, assetPath, options);
}

export function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}

/** Opens through a Rust command that checks the runtime fs scope. */
export async function openLocalPath(path: string): Promise<void> {
  await invoke('open_document_resource', { path });
}

export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}

async function buildStoredAttachment(
  documentPath: string,
  targetPath: string,
  options: AttachmentReferenceOptions
): Promise<StoredAttachment> {
  return {
    markdownPath: formatAttachmentReference(documentPath, targetPath, options),
    absolutePath: normalizePath(targetPath),
  };
}

/**
 * Creates the directory on the Rust side and allows it in the fs scope, so a
 * custom attachment folder outside `$HOME` keeps working across restarts.
 */
async function ensureAttachmentDirectory(dir: string): Promise<void> {
  await invoke('ensure_attachment_directory', { path: dir });
}

const MAX_NAME_ATTEMPTS = 1000;

/**
 * Writes `bytes` to `dir/fileName`, or to `stem-2.ext`, `stem-3.ext`... when
 * that name is taken, and returns the path used. `createNew` makes the claim
 * atomic: a file that appears after the `exists` probe is never overwritten.
 */
async function createUniqueFile(
  dir: string,
  fileName: string,
  bytes: Uint8Array
): Promise<string> {
  const normalizedDir = normalizePath(dir);
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName || 'attachment';
  const ext = dot > 0 ? fileName.slice(dot + 1) : '';

  for (let index = 1; index <= MAX_NAME_ATTEMPTS; index += 1) {
    const name =
      index === 1
        ? fileName
        : ext
          ? `${stem}-${index}.${ext}`
          : `${stem}-${index}`;
    const candidate = normalizePath(`${normalizedDir}/${name}`);
    if (await exists(candidate)) continue;
    try {
      await writeFile(candidate, bytes, { createNew: true });
      return candidate;
    } catch (error) {
      // Lost a race for this name; anything else is a real failure.
      if (!(await exists(candidate))) throw error;
    }
  }
  throw new Error(
    `No free file name for "${fileName}" in ${normalizedDir} after ${MAX_NAME_ATTEMPTS} attempts`
  );
}
