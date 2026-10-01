import { invoke } from '@tauri-apps/api/core';
import { dirname } from '@tauri-apps/api/path';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { watch } from '@tauri-apps/plugin-fs';

export async function openFileDialog(): Promise<string | null> {
  const result = await open({
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    multiple: false,
  });
  return result as string | null;
}

export async function saveFileDialog(): Promise<string | null> {
  const result = await save({
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  return result as string | null;
}

export async function openDirectoryDialog(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
  });
  return result as string | null;
}

export async function confirmDialog(
  message: string,
  options: { title: string; okLabel: string; cancelLabel: string }
): Promise<boolean> {
  return await ask(message, { kind: 'warning', ...options });
}

export async function errorDialog(msg: string): Promise<void> {
  await message(msg, { kind: 'error' });
}

export async function warningDialog(msg: string, title: string): Promise<void> {
  await message(msg, { kind: 'warning', title });
}

export type UnsavedChangesAction = 'save' | 'discard' | 'cancel';

/** Native three-button prompt; dismissing the dialog counts as cancel. */
export async function unsavedChangesDialog(
  body: string,
  options: {
    title: string;
    saveLabel: string;
    discardLabel: string;
    cancelLabel: string;
  }
): Promise<UnsavedChangesAction> {
  const choice = await message(body, {
    title: options.title,
    kind: 'warning',
    buttons: {
      yes: options.saveLabel,
      no: options.discardLabel,
      cancel: options.cancelLabel,
    },
  });
  if (choice === options.saveLabel) return 'save';
  if (choice === options.discardLabel) return 'discard';
  return 'cancel';
}

export type LineEnding = 'lf' | 'crlf';

/** Byte-level properties of a file that survive a read/write round trip. */
export interface DocumentFormat {
  bom: boolean;
  lineEnding: LineEnding;
}

export const DEFAULT_DOCUMENT_FORMAT: Readonly<DocumentFormat> = {
  bom: false,
  lineEnding: 'lf',
};

export interface MarkdownDocument {
  /** Always `\n`-terminated lines; the original style lives in `format`. */
  text: string;
  format: DocumentFormat;
}

export type DocumentErrorKind = 'not-utf8' | 'forbidden' | 'too-large' | 'io';

/** Structured failure from the document commands (see `document.rs`). */
export class DocumentError extends Error {
  constructor(
    readonly kind: DocumentErrorKind,
    readonly path: string,
    /** Encoding a byte order mark identified, e.g. `UTF-16 LE`. */
    readonly encoding: string | null,
    message: string,
    /** Size cap a `too-large` read ran into. */
    readonly limitBytes: number | null = null
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

function toDocumentError(error: unknown, path: string): DocumentError {
  if (error instanceof DocumentError) return error;
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const payload = error as {
      kind: DocumentErrorKind;
      encoding?: string | null;
      message?: string;
      limitBytes?: number;
    };
    return new DocumentError(
      payload.kind,
      path,
      payload.encoding ?? null,
      payload.message ?? payload.kind,
      payload.limitBytes ?? null
    );
  }
  return new DocumentError('io', path, null, String(error));
}

/** Read through the Rust command: strict UTF-8, BOM and EOL detection. */
export async function readMarkdown(path: string): Promise<MarkdownDocument> {
  try {
    return await invoke<MarkdownDocument>('read_markdown_document', { path });
  } catch (error) {
    throw toDocumentError(error, path);
  }
}

/** Atomic write (temp file + rename) that restores the recorded format. */
export async function saveMarkdown(
  path: string,
  text: string,
  format: DocumentFormat
): Promise<void> {
  try {
    await invoke('write_markdown_document', { path, text, format });
  } catch (error) {
    throw toDocumentError(error, path);
  }
}

/**
 * Quiet period before a change is reported. Editors that save by truncating
 * and rewriting emit several events per save; reading on the first one can
 * catch the file half-written.
 */
const WATCH_DEBOUNCE_MS = 300;

/**
 * Watch the folder rather than the file: inotify follows the inode, so once
 * another editor saves by writing a temporary file and renaming it over the
 * document, a watch on the file itself never fires again.
 */
export async function watchMarkdownFile(
  path: string,
  handler: () => void
): Promise<() => void> {
  const target = comparablePath(path);
  return await watch(
    await dirname(path),
    (event) => {
      if (event.paths.some((changed) => comparablePath(changed) === target)) {
        handler();
      }
    },
    { delayMs: WATCH_DEBOUNCE_MS, recursive: false }
  );
}

/** Separator- and, for drive-letter paths, case-insensitive form of a path. */
function comparablePath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  return /^[a-z]:\//i.test(unified) ? unified.toLowerCase() : unified;
}

export async function resolveCurrentWindowFile(): Promise<string | null> {
  return await invoke<string | null>('resolve_current_window_file');
}

/**
 * Tell the backend which file this window now edits (after a dialog open or
 * save-as) so the session map and the fs scope follow it. Returns the
 * canonical path.
 */
export async function registerWindowDocument(path: string): Promise<string> {
  return await invoke<string>('register_window_document', { path });
}

export async function openMarkdownInNewWindow(path: string): Promise<void> {
  await invoke('open_markdown_in_new_window', { path });
}

export async function openNewWindow(): Promise<void> {
  await invoke('open_new_window');
}
