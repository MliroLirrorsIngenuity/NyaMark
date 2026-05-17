import {
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
import { store } from '../state/store';

type Hooks = {
  syncEditorAfterSave: (savedContent: string) => void;
};

export class FileController {
  private unwatch: (() => void) | null = null;
  private watchedPath: string | null = null;
  private lastKnownContent: string | null = null;
  private watchVersion = 0;

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
    if (state.filePath !== path || state.isDirty) {
      return;
    }

    try {
      const newContent = await readMarkdown(path);
      if (newContent === this.lastKnownContent) {
        return;
      }

      this.lastKnownContent = newContent;
      this.hooks.syncEditorAfterSave(newContent);
      store.update({ isDirty: false });
    } catch (error) {
      console.error('Failed to reload changed file:', error);
    }
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
    const savedContent = await saveMarkdown(path, snapshot);
    this.lastKnownContent = savedContent;
    const currentMarkdown = this.getEditor()?.getMarkdown() ?? snapshot;
    const changedWhileSaving = currentMarkdown !== snapshot;

    if (!changedWhileSaving) {
      this.hooks.syncEditorAfterSave(savedContent);
      store.update({ isDirty: false });
      return;
    }

    store.update({ isDirty: true });
  }
}
