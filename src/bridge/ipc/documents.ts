import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Where documents are kept on a phone: iCloud, the device, or a folder the user chose. */
export type LocationKind = 'icloud' | 'local' | 'folder';

export interface DocumentLocation {
  /** `icloud`, `local`, or the id the folder was saved under. */
  id: string;
  kind: LocationKind;
  /** The folder's own name; for `local`, the device's ("iPhone"); empty for `icloud`. */
  name: string;
  /** Null while the location cannot be reached. */
  path: string | null;
  available: boolean;
}

export interface RecentDocument {
  id: string;
  /** File name with its extension. */
  name: string;
  path: string | null;
  /** Name of the folder that holds the file. */
  folder: string | null;
  /** Milliseconds since the epoch. */
  openedAt: number;
  available: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
  kind: 'folder' | 'document';
  /** Milliseconds since the epoch. */
  modifiedAt: number | null;
  /** False for a document iCloud has not downloaded yet; opening it downloads it. */
  downloaded: boolean;
}

/** Screen rectangle a share sheet points to on iPad. */
export interface ShareAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DocumentsErrorCode =
  | 'exists'
  | 'missing'
  | 'forbidden'
  | 'invalid-name'
  | 'unavailable'
  | 'io';

/** A failure the native document layer reported. */
export class DocumentsError extends Error {
  constructor(
    readonly code: DocumentsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DocumentsError';
  }
}

function toDocumentsError(error: unknown): DocumentsError {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const payload = error as { code?: string; message: string };
    return new DocumentsError(
      (payload.code as DocumentsErrorCode | undefined) ?? 'io',
      payload.message
    );
  }
  return new DocumentsError('io', String(error));
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(`plugin:documents|${command}`, args);
  } catch (error) {
    throw toDocumentsError(error);
  }
}

export function documentLocations(): Promise<DocumentLocation[]> {
  return call('locations');
}

/** Asks for a folder with the system's picker and keeps it as a location. */
export function pickFolder(): Promise<DocumentLocation | null> {
  return call('pick_folder');
}

export function removeFolder(id: string): Promise<void> {
  return call('remove_folder', { id });
}

/** The folders and the documents with one of `extensions` directly inside `path`. */
export function listFolder(
  path: string,
  extensions: readonly string[]
): Promise<FolderEntry[]> {
  return call('list', { path, extensions });
}

/** Creates an empty document in `folder`, numbering the name when it is taken. */
export async function createDocument(
  folder: string,
  baseName: string,
  extension: string
): Promise<string> {
  const created = await call<{ path: string }>('create_document', {
    folder,
    baseName,
    extension,
  });
  return created.path;
}

/** Renames a file or folder to `stem`, keeping a file's extension; returns the new path. */
export async function renameItem(path: string, stem: string): Promise<string> {
  const renamed = await call<{ path: string }>('rename', { path, stem });
  return renamed.path;
}

/** Moves the item to Recently Deleted where the location has one, else deletes it. */
export function deleteItem(path: string): Promise<void> {
  return call('delete', { path });
}

/** Asks for a document with the system's picker; it stays where it is. */
export async function pickDocument(
  extensions: readonly string[]
): Promise<string | null> {
  const picked = await call<{ path: string | null }>('pick_document', {
    extensions,
  });
  return picked.path;
}

/** Most recently opened first. */
export function recentDocuments(): Promise<RecentDocument[]> {
  return call('recents');
}

export function removeRecent(id: string): Promise<void> {
  return call('remove_recent', { id });
}

/** Resolves once the file is on the device; iCloud may still have to download it. */
export function downloadDocument(path: string): Promise<void> {
  return call('download', { path });
}

/** Keeps the document among the recent ones and as the one to reopen at launch. */
export function noteDocumentOpened(path: string): Promise<void> {
  return call('opened', { path });
}

/** The document to reopen at launch; null for the library. */
export function setCurrentDocument(path: string | null): Promise<void> {
  return call('set_current', { path });
}

export async function currentDocument(): Promise<string | null> {
  const current = await call<{ path: string | null }>('current');
  return current.path;
}

/** Offers a copy of the file in the share sheet, under `name`. */
export function shareFile(
  path: string,
  name: string,
  anchor: ShareAnchor | null
): Promise<void> {
  return call('share', { path, name, anchor });
}

/** Paper size and margin, in points. */
export interface PdfPage {
  width: number;
  height: number;
  margin: number;
}

/** Lays the page out for print and offers the PDF in the share sheet. */
export function sharePdf(
  name: string,
  page: PdfPage,
  anchor: ShareAnchor | null
): Promise<void> {
  return call('share_pdf', { name, page, anchor });
}

export function printPage(name: string): Promise<void> {
  return call('print', { name });
}

/** Appends what other apps shared to the inbox document `fileName`; its path, or null when nothing came. */
export async function drainInbox(fileName: string): Promise<string | null> {
  const drained = await call<{ path: string | null }>('drain_inbox', {
    fileName,
  });
  return drained.path;
}

/** Keeps a picture of the page on screen until `uncoverPage`, so a reload does not flash. */
export function coverPage(): Promise<void> {
  return call('cover');
}

export function uncoverPage(): Promise<void> {
  return call('uncover');
}

/** iOS handed over a document to open, from the Files app or another app. */
export function onOpenDocumentRequest(
  handler: (path: string) => void
): Promise<() => void> {
  return listen<string>('nyamark://open-document', (event) =>
    handler(event.payload)
  );
}
