import {
  confirmDialog,
  DEFAULT_DOCUMENT_FORMAT,
  DocumentError,
  type DocumentFormat,
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
import { relocateLocalReference } from './attachment-policy';

type Hooks = {
  syncEditorAfterSave: (savedContent: string) => void;
  /** Push edits buffered outside the editor (the source pane) into it. */
  flushPendingEdits: () => void;
};

export class FileController {
  private unwatch: (() => void) | null = null;
  private watchedPath: string | null = null;
  private lastKnownContent: string | null = null;
  /** BOM / line ending style of the file on disk, restored on every save. */
  private documentFormat: DocumentFormat = { ...DEFAULT_DOCUMENT_FORMAT };
  private watchVersion = 0;
  private conflictPrompting = false;

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
      return { filePath, markdown: document.text };
    } catch (error) {
      // The window stays open but untitled; a silent blank editor would look
      // like the file was empty and invite a save over it.
      console.error('Failed to read initial document:', error);
      await errorDialog(this.describeDocumentError(error, filePath, 'open'));
      return { filePath: null, markdown: '' };
    }
  }

  private async updateWatcher(path: string | null, force = false) {
    if (!force && this.watchedPath === path) return;

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }

    this.watchVersion += 1;
    const watchVersion = this.watchVersion;
    this.watchedPath = path;
    if (!path) return;

    try {
      const unwatch = await watchMarkdownFile(path, () => {
        void this.reloadChangedFile(path);
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

  private async reloadChangedFile(path: string) {
    // Keystrokes still buffered in the source pane are unsaved edits too and
    // must count towards the dirty check below.
    this.flushPendingEdits();
    const state = store.getState();
    if (state.filePath !== path) {
      return;
    }

    let newContent: string;
    try {
      const document = await readMarkdown(path);
      newContent = document.text;
      // Whoever rewrote the file may also have changed its BOM or line
      // endings; the next save follows the file as it is now.
      this.documentFormat = document.format;
    } catch (error) {
      console.error('Failed to reload changed file:', error);
      return;
    }

    // Ignore events that report no real change (most commonly our own save).
    if (newContent === this.lastKnownContent) {
      return;
    }

    if (!state.isDirty) {
      this.applyExternalContent(newContent);
      return;
    }

    // The file changed on disk while we hold unsaved edits. Ask before
    // discarding either side instead of silently dropping the external change
    // (and later overwriting it on save).
    if (this.conflictPrompting) return;
    this.conflictPrompting = true;
    let reload = false;
    try {
      reload = await this.confirmExternalReload(path);
    } finally {
      this.conflictPrompting = false;
    }

    // The document may have been saved or closed while the prompt was open.
    if (store.getState().filePath !== path) return;

    if (reload) {
      this.applyExternalContent(newContent);
    } else {
      // Keep local edits but adopt the disk version as the new baseline so the
      // same change does not prompt again; the doc stays dirty and the next
      // save intentionally overwrites disk.
      this.lastKnownContent = newContent;
    }
  }

  private applyExternalContent(content: string) {
    this.lastKnownContent = content;
    this.hooks.syncEditorAfterSave(content);
    store.update({ isDirty: false });
  }

  private async confirmExternalReload(path: string): Promise<boolean> {
    const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
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
    const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
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
    }
    return i18next.t(
      action === 'open'
        ? 'dialog.documentError.openFailed'
        : 'dialog.documentError.saveFailed',
      { fileName, reason }
    );
  }

  async autoSaveFile() {
    try {
      await this.saveCurrentDocument({
        forceDialog: false,
        allowDialogWhenMissingPath: false,
      });
    } catch (error) {
      console.error('Failed to auto-save file:', error);
    }
  }

  private async saveCurrentDocument(options: {
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

    if (state.filePath !== path) {
      this.relocateAttachmentReferences(editor, state.filePath, path);
    }
    await this.saveToExistingPath(path, editor.getMarkdown());
    if (state.filePath !== path) {
      const registeredPath = await this.registerDocumentPath(path);
      store.update({ filePath: registeredPath });
      return registeredPath;
    }
    return path;
  }

  /**
   * The document is about to be written at `nextPath`. Relative references
   * were resolved against the old directory and would all break; absolute
   * ones left by inserts into a never-saved document become relative when
   * the settings prefer that.
   */
  private relocateAttachmentReferences(
    editor: NyaEditor,
    previousPath: string | null,
    nextPath: string
  ) {
    const options = getSettings().attachments;
    editor.rewriteLocalReferences((reference) =>
      relocateLocalReference(reference, previousPath, nextPath, options)
    );
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

  private async saveToExistingPath(path: string, snapshot: string) {
    // Update before the write so the file-watcher callback that fires during
    // the async IPC round-trip (very fast on Windows NTFS) sees the expected
    // content and does not trigger a spurious "file changed externally" dialog.
    const prevLastKnown = this.lastKnownContent;
    this.lastKnownContent = snapshot;
    try {
      await saveMarkdown(path, snapshot, this.documentFormat);
    } catch (error) {
      this.lastKnownContent = prevLastKnown;
      throw error;
    }
    // The atomic save renamed a new inode over the old one. inotify watches
    // the inode, so on Linux the watcher would go quiet from here on; macOS
    // and Windows watch by path and only pay for a cheap re-subscribe.
    if (this.watchedPath === path) {
      void this.updateWatcher(path, true);
    }
    const currentMarkdown = this.getEditor()?.getMarkdown() ?? snapshot;
    if (currentMarkdown !== snapshot) {
      store.update({ isDirty: true });
      return;
    }
    this.hooks.syncEditorAfterSave(snapshot);
    store.update({ isDirty: false });
  }
}
