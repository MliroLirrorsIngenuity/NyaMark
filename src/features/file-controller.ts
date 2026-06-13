import {
  confirmDialog,
  errorDialog,
  openFileDialog,
  openMarkdownInNewWindow,
  openNewWindow,
  readMarkdown,
  resolveCurrentWindowFile,
  saveFileDialog,
  saveMarkdown,
  watchMarkdownFile,
} from '../bridge/ipc/files';
import type { NyaEditor } from '../editor/editor';
import { i18next } from '../i18n';
import { store } from '../state/store';

type Hooks = {
  syncEditorAfterSave: (savedContent: string) => void;
};

export class FileController {
  private unwatch: (() => void) | null = null;
  private watchedPath: string | null = null;
  private lastKnownContent: string | null = null;
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

  async resolveInitialDocument(): Promise<{
    filePath: string | null;
    markdown: string;
  }> {
    try {
      const filePath = await resolveCurrentWindowFile();
      if (!filePath) return { filePath: null, markdown: '' };
      const markdown = await readMarkdown(filePath);
      this.lastKnownContent = markdown;
      return { filePath, markdown };
    } catch (error) {
      console.error('Failed to resolve initial document:', error);
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
    const state = store.getState();
    if (state.filePath !== path) {
      return;
    }

    let newContent: string;
    try {
      newContent = await readMarkdown(path);
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
      return null;
    }
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

    const state = store.getState();
    if (!state.isDirty && !options.forceDialog) {
      return state.filePath;
    }

    const path = options.forceDialog
      ? await saveFileDialog()
      : (state.filePath ??
        (options.allowDialogWhenMissingPath ? await saveFileDialog() : null));

    if (!path) return null;

    await this.saveToExistingPath(path, editor.getMarkdown());
    if (state.filePath !== path) {
      store.update({ filePath: path });
    }
    return path;
  }

  private async saveToExistingPath(path: string, snapshot: string) {
    // Update before the write so the file-watcher callback that fires during
    // the async IPC round-trip (very fast on Windows NTFS) sees the expected
    // content and does not trigger a spurious "file changed externally" dialog.
    const prevLastKnown = this.lastKnownContent;
    this.lastKnownContent = snapshot;
    try {
      await saveMarkdown(path, snapshot);
    } catch (error) {
      this.lastKnownContent = prevLastKnown;
      throw error;
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
