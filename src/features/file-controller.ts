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
        const savedContent = await saveMarkdown(state.filePath, editor.getMarkdown());
        this.hooks.syncEditorAfterSave(savedContent);
        store.update({ isDirty: false });
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
        const savedContent = await saveMarkdown(path, editor.getMarkdown());
        this.hooks.syncEditorAfterSave(savedContent);
        store.update({ filePath: path, isDirty: false });
        return path;
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
    return null;
  }
}
