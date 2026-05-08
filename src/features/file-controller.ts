import {
  openFileDialog,
  openMarkdownInNewWindow,
  openNewWindow,
  readMarkdown,
  resolveCurrentWindowFile,
  saveFileDialog,
  saveMarkdown,
} from '../bridge/ipc/files';
import { invoke } from '@tauri-apps/api/core';
import type { NyaEditor } from '../editor/editor';
import { store } from '../state/store';

type Hooks = {
  syncEditorAfterSave: (savedContent: string) => void;
};

export class FileController {
  private unwatch: (() => void) | null = null;
  private watchedPath: string | null = null;
  private lastKnownContent: string | null = null;

  constructor(
    private readonly getEditor: () => NyaEditor | null,
    private readonly hooks: Hooks
  ) {
    store.subscribe((state) => {
      this.updateWatcher(state.filePath);
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

  private updateWatcher(path: string | null) {
    if (this.watchedPath === path) return;

    if (this.unwatch) {
      window.clearInterval(this.unwatch as unknown as number);
      this.unwatch = null;
    }

    this.watchedPath = path;
    if (!path) return;

    let lastMtime: number | null = null;
    invoke<number>('get_file_modified_time', { path })
      .then((mtime) => (lastMtime = mtime))
      .catch(() => {});

    const timer = window.setInterval(async () => {
      try {
        const currentMtime = await invoke<number>('get_file_modified_time', {
          path,
        });
        if (lastMtime !== null && currentMtime !== lastMtime) {
          lastMtime = currentMtime;

          const state = store.getState();
          if (state.isDirty) {
            return;
          }

          try {
            const newContent = await readMarkdown(path);
            if (newContent !== this.lastKnownContent) {
              this.lastKnownContent = newContent;
              this.hooks.syncEditorAfterSave(newContent);
              store.update({ isDirty: false });
            }
          } catch (error) {
            console.error('Failed to reload changed file:', error);
          }
        } else {
          lastMtime = currentMtime;
        }
      } catch (error) {}
    }, 1000);

    this.unwatch = () => window.clearInterval(timer);
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
