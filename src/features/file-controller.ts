import {
  openFileDialog,
  openMarkdownInNewWindow,
  openNewWindow,
  readMarkdown,
  resolveCurrentWindowFile,
  saveFileDialog,
  saveMarkdown,
} from '../bridge/ipc/files';
import type { NyaEditor } from '../editor/editor';
import { store } from '../state/store';

type Hooks = {
  /** Sync editor markdown back from the post-save canonical content. */
  syncEditorAfterSave: (savedContent: string) => void;
};

export class FileController {
  constructor(
    private readonly getEditor: () => NyaEditor | null,
    private readonly hooks: Hooks
  ) {}

  async resolveInitialDocument(): Promise<{ filePath: string | null; markdown: string }> {
    try {
      const filePath = await resolveCurrentWindowFile();
      if (!filePath) return { filePath: null, markdown: '' };
      const markdown = await readMarkdown(filePath);
      return { filePath, markdown };
    } catch (error) {
      console.error('Failed to resolve initial document:', error);
      return { filePath: null, markdown: '' };
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
    const editor = this.getEditor();
    if (!editor) return;
    const state = store.getState();

    try {
      if (state.filePath) {
        await this.saveToExistingPath(state.filePath, editor.getMarkdown());
      } else {
        await this.saveFileAs();
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }

  async saveFileAs(): Promise<string | null> {
    const editor = this.getEditor();
    if (!editor) return null;
    try {
      const path = await saveFileDialog();
      if (path) {
        await this.saveToExistingPath(path, editor.getMarkdown());
        store.update({ filePath: path });
        return path;
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
    return null;
  }

  async autoSaveFile() {
    const editor = this.getEditor();
    if (!editor) return;

    const state = store.getState();
    if (!state.filePath || !state.isDirty) return;

    try {
      await this.saveToExistingPath(state.filePath, editor.getMarkdown());
    } catch (error) {
      console.error('Failed to auto-save file:', error);
    }
  }

  private async saveToExistingPath(path: string, snapshot: string) {
    const savedContent = await saveMarkdown(path, snapshot);
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
