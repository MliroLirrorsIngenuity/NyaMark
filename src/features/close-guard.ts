import { unsavedChangesDialog } from '../bridge/ipc/files';
import {
  cancelPendingQuit,
  onWindowCloseRequested,
  setWindowDirty,
} from '../bridge/ipc/windows';
import { i18next } from '../i18n';
import { store } from '../state/store';
import type { FileController } from './file-controller';

/**
 * Stands between every "close this window" request and the actual destroy.
 * The titlebar close button, Alt+F4 / Cmd+W, and the Rust-side quit and
 * restart flows all arrive through `onCloseRequested`, so this is the one
 * place that prompts for unsaved changes.
 */
export class CloseGuard {
  private prompting = false;
  private reportedDirty: boolean | null = null;

  constructor(private readonly fileController: FileController) {}

  async bind() {
    store.subscribe((state) => this.reportDirty(state.isDirty));
    await onWindowCloseRequested(() => this.confirmClose());
  }

  /** Resolves `true` when the window may close. */
  async confirmClose(): Promise<boolean> {
    if (!store.getState().isDirty) return true;
    // A second request while the prompt is open (e.g. Cmd+Q after clicking
    // close) must not stack another dialog.
    if (this.prompting) return false;

    this.prompting = true;
    try {
      const action = await unsavedChangesDialog(
        i18next.t('dialog.unsavedChanges.body', {
          fileName: this.currentFileName(),
        }),
        {
          title: i18next.t('dialog.unsavedChanges.title'),
          saveLabel: i18next.t('dialog.unsavedChanges.save'),
          discardLabel: i18next.t('dialog.unsavedChanges.discard'),
          cancelLabel: i18next.t('dialog.unsavedChanges.cancel'),
        }
      );

      if (action === 'discard') {
        // Clear the flag before the destroy so a quit/restart that waits on the
        // last window never sees this one as dirty.
        await this.reportDirty(false);
        return true;
      }

      if (action === 'save') {
        await this.fileController.saveFile();
        if (!store.getState().isDirty) return true;
      }

      // Cancelled, or the save dialog was dismissed.
      await cancelPendingQuit().catch(console.error);
      return false;
    } finally {
      this.prompting = false;
    }
  }

  private async reportDirty(dirty: boolean) {
    if (this.reportedDirty === dirty) return;
    this.reportedDirty = dirty;
    try {
      await setWindowDirty(dirty);
    } catch (error) {
      this.reportedDirty = null;
      console.error('Failed to report dirty state:', error);
    }
  }

  private currentFileName() {
    const path = store.getState().filePath;
    return path
      ? path.split(/[\\/]/).filter(Boolean).pop() || 'Untitled.md'
      : 'Untitled.md';
  }
}
