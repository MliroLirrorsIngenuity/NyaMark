import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';

export type StoredAttachment = {
  markdownPath: string;
  absolutePath: string;
};

export async function materializeAttachment(
  documentPath: string,
  fileName: string,
  bytes: number[]
): Promise<StoredAttachment> {
  return await invoke('materialize_attachment', { documentPath, fileName, bytes });
}

export async function materializeDraftAttachment(
  fileName: string,
  bytes: number[]
): Promise<StoredAttachment> {
  return await invoke('materialize_draft_attachment', { fileName, bytes });
}

export async function storeAttachmentInDirectory(
  documentPath: string,
  targetDir: string,
  fileName: string,
  bytes: number[]
): Promise<StoredAttachment> {
  return await invoke('store_attachment_in_directory', {
    documentPath,
    targetDir,
    fileName,
    bytes,
  });
}

export async function copyLocalAttachment(
  documentPath: string,
  sourcePath: string,
  targetDir: string
): Promise<StoredAttachment> {
  return await invoke('copy_local_attachment', { documentPath, sourcePath, targetDir });
}

export async function resolveDocumentAssetPath(
  documentPath: string | null,
  assetPath: string
): Promise<string | null> {
  return await invoke('resolve_document_asset_path', { documentPath, assetPath });
}

export async function formatMarkdownReference(
  documentPath: string | null,
  assetPath: string
): Promise<string> {
  return await invoke('format_markdown_reference', { documentPath, assetPath });
}

export function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export async function openLocalPath(path: string): Promise<void> {
  await openPath(path);
}

export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}
