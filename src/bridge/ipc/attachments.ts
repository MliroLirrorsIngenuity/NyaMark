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
  bytes: number[],
  options: AttachmentReferenceOptions
): Promise<StoredAttachment> {
  const storageDir = resolveStorageDir(documentPath, targetDir);
  const targetPath = await writeAttachmentFile(storageDir, fileName, bytes);
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

  const fileName = basenamePath(sourcePath) || 'attachment';
  const targetPath = await uniqueFilePath(
    storageDir,
    sanitizeFileName(fileName)
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

async function writeAttachmentFile(
  dir: string,
  fileName: string,
  bytes: number[]
) {
  await ensureAttachmentDirectory(dir);
  const safeName = sanitizeFileName(fileName);
  const targetPath = await uniqueFilePath(dir, safeName);
  await writeFile(targetPath, new Uint8Array(bytes));
  return normalizePath(targetPath);
}

/**
 * Creates the directory on the Rust side and allows it in the fs scope, so a
 * custom attachment folder outside `$HOME` keeps working across restarts.
 */
async function ensureAttachmentDirectory(dir: string): Promise<void> {
  await invoke('ensure_attachment_directory', { path: dir });
}

async function uniqueFilePath(dir: string, fileName: string) {
  const normalizedDir = normalizePath(dir);
  const initial = normalizePath(`${normalizedDir}/${fileName}`);
  if (!(await exists(initial))) {
    return initial;
  }

  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName || 'attachment';
  const ext = dot > 0 ? fileName.slice(dot + 1) : '';

  for (let index = 2; ; index += 1) {
    const candidateName = ext ? `${stem}-${index}.${ext}` : `${stem}-${index}`;
    const candidate = normalizePath(`${normalizedDir}/${candidateName}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}
