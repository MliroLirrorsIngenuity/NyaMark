import {
  DEFAULT_DOCUMENT_FORMAT,
  DocumentError,
  type DocumentFormat,
  type MarkdownDocument,
  confirmDialog,
  errorDialog,
  openFileDialog,
  openMarkdownInNewWindow,
  openNewWindow,
  readMarkdown,
  registerWindowDocument,
  resolveCurrentWindowFile,
  saveFileDialog,
  saveMarkdown,
  watchMarkdownFile,
} from '../bridge/ipc/files';
import type { NyaEditor } from '../editor/editor';
import { i18next } from '../i18n';
import { getSettings } from '../state/settings';
import { store } from '../state/store';
import { basenamePath } from './attachment-paths';
import { relocateLocalReference } from './attachment-policy';

type Hooks = {
  syncEditorAfterSave: (savedContent: string) => void;
  /** Push edits buffered outside the editor (the source pane) into it. */
  flushPendingEdits: () => void;
  /**
   * The file no longer holds the document as last saved: it went, or another
   * program rewrote it and the edits were kept. Undone back to that, the
   * document is still unsaved.
   */
  fileDiverged?: () => void;
};

/**
 * Where a reload of the file left the document: `unchanged` when the file
 * holds the text as last read or saved here, `kept` when the edits here were
 * kept over another program's version. After either, a save the change held
 * up goes ahead.
 */
type ReloadOutcome =
  | 'unchanged'
  | 'reloaded'
  | 'kept'
  | 'missing'
  | 'unreadable'
  | 'moved';

/** Saves that find the file changed again by the time they write give up. */
const MAX_SAVE_ATTEMPTS = 3;

export class FileController {
  private unwatch: (() => void) | null = null;
  private watchedPath: string | null = null;
  private lastKnownContent: string | null = null;
  /** BOM / line ending style of the file on disk, restored on every save. */
  private documentFormat: DocumentFormat = { ...DEFAULT_DOCUMENT_FORMAT };
  /**
   * The file as this window last read or wrote it. A save passes it to the
   * write, which leaves alone a file another program changed since: the
   * watcher reports such a change late, and misses it on some volumes.
   */
  private diskVersion: string | null = null;
  private watchVersion = 0;
  private conflictPrompting = false;
  /**
   * Set while the file is gone from disk, deleted or moved by another
   * program: the text the document held when it went, and whether that was
   * saved. Nothing on disk holds the document then, so it counts as unsaved.
   */
  private missing: { text: string; dirty: boolean } | null = null;
  /** Tail of the save queue; see `enqueue`. */
  private saveQueue: Promise<unknown> = Promise.resolve();
  /** Set once an auto-save failure was shown; cleared by the next good save. */
  private autoSaveFailureShown = false;

  constructor(
    private readonly getEditor: () => NyaEditor | null,
    private readonly hooks: Hooks
  ) {
    store.subscribe((state) => {
      void this.updateWatcher(state.filePath);
    });
  }

  public getLastKnownContent(): string | null {
    return this.lastKnownContent;
  }

  /** Make the editor (and thus `store.isDirty`) reflect every keystroke so far. */
  public flushPendingEdits() {
    this.hooks.flushPendingEdits();
  }

  async resolveInitialDocument(): Promise<{
    filePath: string | null;
    markdown: string;
  }> {
    let filePath: string | null = null;
    try {
      filePath = await resolveCurrentWindowFile();
    } catch (error) {
      console.error('Failed to resolve initial document:', error);
      return { filePath: null, markdown: '' };
    }
    if (!filePath) return { filePath: null, markdown: '' };

    try {
      const document = await readMarkdown(filePath);
      this.lastKnownContent = document.text;
      this.documentFormat = document.format;
      this.diskVersion = document.version;
      return { filePath, markdown: document.text };
    } catch (error) {
      // The window stays open but untitled; a silent blank editor would look
      // like the file was empty and invite a save over it.
      console.error('Failed to read initial document:', error);
      await errorDialog(this.describeDocumentError(error, filePath, 'open'));
      return { filePath: null, markdown: '' };
    }
  }

  private async updateWatcher(path: string | null) {
    if (this.watchedPath === path) return;

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }

    this.watchVersion += 1;
    const watchVersion = this.watchVersion;
    this.watchedPath = path;
    this.missing = null;
    if (!path) return;

    try {
      const unwatch = await watchMarkdownFile(path, () => {
        this.enqueue(() => this.reloadChangedFile(path)).catch((error) => {
          console.error('Failed to reload changed file:', error);
        });
      });

      if (this.watchVersion !== watchVersion) {
        unwatch();
        return;
      }

      this.unwatch = unwatch;
    } catch (error) {
      console.error('Failed to watch file changes:', error);
    }
  }

  /**
   * Takes in the file as another program left it. Runs in the save queue, so
   * a save of this window's is never read halfway and taken for another's.
   */
  private async reloadChangedFile(path: string): Promise<ReloadOutcome> {
    const state = store.getState();
    if (state.filePath !== path) {
      return 'moved';
    }

    let document: MarkdownDocument;
    try {
      document = await readMarkdown(path);
    } catch (error) {
      if (error instanceof DocumentError && error.kind === 'missing') {
        this.markMissing();
        return 'missing';
      }
      console.error('Failed to reload changed file:', error);
      return 'unreadable';
    }
    // Keystrokes still buffered in the source pane are unsaved edits too and
    // must count towards the dirty check below, those typed during the read
    // as well.
    this.flushPendingEdits();
    const { text: newContent, version } = document;
    // Whoever rewrote the file may also have changed its BOM or line
    // endings; the next save follows the file as it is now.
    this.documentFormat = document.format;

    // The file is back, rewritten by a program that deletes it first or put
    // back from the trash. A document unedited since it went is as saved as
    // it was then.
    let dirty = store.getState().isDirty;
    if (this.missing) {
      const { text, dirty: before } = this.missing;
      if (this.getEditor()?.getMarkdown() === text) dirty = before;
      this.missing = null;
    }

    // Ignore events that report no real change (most commonly our own save).
    if (newContent === this.lastKnownContent) {
      this.diskVersion = version;
      if (dirty !== store.getState().isDirty) store.update({ isDirty: dirty });
      return 'unchanged';
    }

    if (!dirty) {
      this.applyExternalContent(newContent, version);
      return 'reloaded';
    }

    // The file changed on disk while we hold unsaved edits. Ask before
    // discarding either side instead of silently dropping the external change
    // (and later overwriting it on save).
    this.conflictPrompting = true;
    let reload = false;
    try {
      reload = await this.confirmExternalReload(path);
    } finally {
      this.conflictPrompting = false;
    }

    // The document may have been closed while the prompt was open.
    if (store.getState().filePath !== path) return 'moved';

    if (reload) {
      this.applyExternalContent(newContent, version);
      return 'reloaded';
    }
    // Keep local edits but adopt the disk version as the new baseline so the
    // same change does not prompt again; the doc stays dirty and the next
    // save intentionally overwrites disk.
    this.lastKnownContent = newContent;
    this.diskVersion = version;
    this.hooks.fileDiverged?.();
    return 'kept';
  }

  /**
   * The open file was deleted or moved. The document stays open and unsaved,
   * so closing it asks first; saved, it is written where the file was.
   */
  private markMissing() {
    if (this.missing) return;
    this.missing = {
      text: this.getEditor()?.getMarkdown() ?? '',
      dirty: store.getState().isDirty,
    };
    this.hooks.fileDiverged?.();
    store.update({ isDirty: true });
  }

  private applyExternalContent(content: string, version: string) {
    this.lastKnownContent = content;
    this.diskVersion = version;
    this.hooks.syncEditorAfterSave(content);
    store.update({ isDirty: false });
  }

  private async confirmExternalReload(path: string): Promise<boolean> {
    const fileName = basenamePath(path);
    return await confirmDialog(
      i18next.t('dialog.fileConflict.body', { fileName }),
      {
        title: i18next.t('dialog.fileConflict.title'),
        okLabel: i18next.t('dialog.fileConflict.reload'),
        cancelLabel: i18next.t('dialog.fileConflict.keep'),
      }
    );
  }

  async newFile() {
    try {
      await openNewWindow();
    } catch (error) {
      console.error('Failed to create new file window:', error);
      await errorDialog(String(error));
    }
  }

  async openFile() {
    try {
      const path = await openFileDialog();
      if (path) await openMarkdownInNewWindow(path);
    } catch (error) {
      console.error('Failed to open file:', error);
      await errorDialog(String(error));
    }
  }

  async saveFile() {
    try {
      await this.saveCurrentDocument({
        forceDialog: false,
        allowDialogWhenMissingPath: true,
      });
    } catch (error) {
      console.error('Failed to save file:', error);
      await errorDialog(this.describeDocumentError(error, null, 'save'));
    }
  }

  async saveFileAs(): Promise<string | null> {
    try {
      return await this.saveCurrentDocument({
        forceDialog: true,
        allowDialogWhenMissingPath: true,
      });
    } catch (error) {
      console.error('Failed to save file as:', error);
      await errorDialog(this.describeDocumentError(error, null, 'save'));
      return null;
    }
  }

  private describeDocumentError(
    error: unknown,
    fallbackPath: string | null,
    action: 'open' | 'save'
  ): string {
    const path =
      error instanceof DocumentError ? error.path : (fallbackPath ?? '');
    const fileName = basenamePath(path);
    const reason = error instanceof Error ? error.message : String(error);

    if (error instanceof DocumentError) {
      if (error.kind === 'not-utf8') {
        return error.encoding
          ? i18next.t('dialog.documentError.notUtf8Known', {
              fileName,
              encoding: error.encoding,
            })
          : i18next.t('dialog.documentError.notUtf8', { fileName });
      }
      if (error.kind === 'forbidden') {
        return i18next.t('dialog.documentError.forbidden', { fileName });
      }
      if (error.kind === 'read-only') {
        return i18next.t('dialog.documentError.readOnly', { fileName });
      }
      if (error.kind === 'too-large') {
        const limit = Math.round((error.limitBytes ?? 0) / (1024 * 1024));
        return i18next.t('dialog.documentError.tooLarge', { fileName, limit });
      }
      if (error.kind === 'changed') {
        return i18next.t('dialog.documentError.changed', { fileName });
      }
    }
    return i18next.t(
      action === 'open'
        ? 'dialog.documentError.openFailed'
        : 'dialog.documentError.saveFailed',
      { fileName, reason }
    );
  }

  async autoSaveFile() {
    // While the reload question is open the file holds the other program's
    // version; a tick wrote over it, and "Reload" then loaded a version no
    // longer on disk.
    if (this.conflictPrompting) return;
    // A file moved or deleted on purpose came back at its old name on the
    // next tick; only a save asked for writes it there again.
    if (this.missing) return;
    try {
      await this.saveCurrentDocument({
        forceDialog: false,
        allowDialogWhenMissingPath: false,
      });
    } catch (error) {
      console.error('Failed to auto-save file:', error);
      // Auto-save retries on every tick; tell the user once per failure
      // streak rather than once a minute.
      if (this.autoSaveFailureShown) return;
      this.autoSaveFailureShown = true;
      await errorDialog(
        this.describeDocumentError(error, store.getState().filePath, 'save')
      );
    }
  }

  private saveCurrentDocument(options: {
    forceDialog: boolean;
    allowDialogWhenMissingPath: boolean;
  }): Promise<string | null> {
    return this.enqueue(() => this.saveCurrentDocumentNow(options));
  }

  /**
   * Saves, and reloads of the file another program changed, run one at a
   * time. An auto-save tick and Cmd+S (or the close prompt) would otherwise
   * write the same file concurrently, and the older snapshot could land last.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.saveQueue.then(task);
    // The queue itself never rejects, so one failed save does not block later ones.
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  private async saveCurrentDocumentNow(options: {
    forceDialog: boolean;
    allowDialogWhenMissingPath: boolean;
  }): Promise<string | null> {
    const editor = this.getEditor();
    if (!editor) return null;

    // The source pane syncs into the editor on a debounce; without this the
    // snapshot below (and the dirty check) would miss the last keystrokes.
    this.flushPendingEdits();
    const state = store.getState();
    if (!state.isDirty && !options.forceDialog) {
      return state.filePath;
    }

    const path = options.forceDialog
      ? await saveFileDialog()
      : (state.filePath ??
        (options.allowDialogWhenMissingPath ? await saveFileDialog() : null));

    if (!path) return null;

    if (state.filePath === path) {
      // Save As onto the document's own file replaces it, as the save
      // dialog asked first.
      if (options.forceDialog) {
        await this.saveToExistingPath(path, editor.getMarkdown(), null);
      } else {
        await this.saveOverOwnFile(path);
      }
      return path;
    }
    // References move with the file only once it is written there: moved
    // first, a failed write left them pointing from a folder the document
    // never reached, and the next save wrote them into the original.
    const moved = await editor.referencesMoved(
      this.referenceRelocation(state.filePath, path)
    );
    await this.saveToExistingPath(path, moved.markdown, null, moved.apply);
    const registeredPath = await this.registerDocumentPath(path);
    store.update({ filePath: registeredPath });
    return registeredPath;
  }

  /**
   * How references read once the document moves to `nextPath`. Relative
   * ones were resolved against the old directory and would all break;
   * absolute ones left by inserts into a never-saved document become
   * relative when the settings prefer that.
   */
  private referenceRelocation(previousPath: string | null, nextPath: string) {
    const options = getSettings().attachments;
    return (reference: string) =>
      relocateLocalReference(reference, previousPath, nextPath, options);
  }

  /**
   * A path picked in the save dialog is only known to the dialog plugin's
   * scope grant. Registering it binds the file to this window on the Rust side
   * (session map + fs scope for the document directory) and yields the
   * canonical path. Falls back to the raw path so a registration failure never
   * loses a completed save.
   */
  private async registerDocumentPath(path: string): Promise<string> {
    try {
      return await registerWindowDocument(path);
    } catch (error) {
      console.error('Failed to register document path:', error);
      return path;
    }
  }

  /**
   * Writes the document over its file unless another program changed the
   * file since this window last read or wrote it. That change is then taken
   * in as the watcher would have, asking first when there are edits here,
   * and edits kept are written over it.
   */
  private async saveOverOwnFile(path: string) {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const editor = this.getEditor();
      if (!editor) return;
      try {
        await this.saveToExistingPath(
          path,
          editor.getMarkdown(),
          this.diskVersion
        );
        return;
      } catch (error) {
        if (!(error instanceof DocumentError && error.kind === 'changed')) {
          throw error;
        }
      }
      const outcome = await this.reloadChangedFile(path);
      // A version this window cannot read is never written over unseen.
      if (outcome === 'unreadable') break;
      if (outcome !== 'unchanged' && outcome !== 'kept') return;
      if (!store.getState().isDirty) return;
    }
    throw new DocumentError('changed', path, null, 'File changed on disk');
  }

  /**
   * `expectedVersion` is the version of the file the snapshot replaces, or
   * null to replace whatever is there. `written` runs once `snapshot` is on
   * disk, before the dirty check.
   */
  private async saveToExistingPath(
    path: string,
    snapshot: string,
    expectedVersion: string | null,
    written?: () => void
  ) {
    // Update before the write so the file-watcher callback that fires during
    // the async IPC round-trip (very fast on Windows NTFS) sees the expected
    // content and does not trigger a spurious "file changed externally" dialog.
    const prevLastKnown = this.lastKnownContent;
    this.lastKnownContent = snapshot;
    try {
      this.diskVersion = await saveMarkdown(
        path,
        snapshot,
        this.documentFormat,
        expectedVersion
      );
    } catch (error) {
      this.lastKnownContent = prevLastKnown;
      throw error;
    }
    this.autoSaveFailureShown = false;
    this.missing = null;
    written?.();
    // What was typed in the source pane while the file was written counts.
    this.flushPendingEdits();
    const currentMarkdown = this.getEditor()?.getMarkdown() ?? snapshot;
    if (currentMarkdown !== snapshot) {
      store.update({ isDirty: true });
      return;
    }
    this.hooks.syncEditorAfterSave(snapshot);
    store.update({ isDirty: false });
  }
}
