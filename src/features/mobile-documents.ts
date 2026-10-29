import {
  coverPage,
  createDocument,
  currentDocument,
  deleteItem,
  documentLocations,
  downloadDocument,
  drainInbox,
  noteDocumentOpened,
  onOpenDocumentRequest,
  pickDocument,
  renameItem,
  setCurrentDocument,
  shareFile,
  uncoverPage,
} from '../bridge/ipc/documents';
import { errorDialog, registerWindowDocument } from '../bridge/ipc/files';
import { afterFirstFrame } from '../editor/open-in-parts';
import { i18next } from '../i18n';
import { store } from '../state/store';
import { documentFileName } from '../ui/document-name';
import { Library, type LibraryHost } from '../ui/library/library';
import { MARKDOWN_EXTENSIONS } from './attachment-policy';
import type { FileController } from './file-controller';

function reportFailure(error: unknown) {
  console.error('[documents]', error);
  const reason = error instanceof Error ? error.message : String(error);
  void errorDialog(i18next.t('library.errors.failed', { reason }));
}

/**
 * A phone's one window shows one document at a time: another one opened
 * takes its place, after the edits are saved, by reloading the page bound to
 * the new file, so every part of the editor starts afresh.
 */
export class MobileDocuments implements LibraryHost {
  private readonly library = new Library(this);

  constructor(private readonly files: FileController) {}

  /** The document open when the app was last on screen, bound to this window. */
  static async restore(): Promise<string | null> {
    try {
      const path = await currentDocument();
      if (!path) return null;
      await downloadDocument(path);
      return await registerWindowDocument(path);
    } catch (error) {
      console.error('[documents] Failed to reopen the last document', error);
      return null;
    }
  }

  async start() {
    const path = this.currentPath();
    if (path) {
      await noteDocumentOpened(path).catch(console.error);
    } else {
      await this.library.show();
    }
    void onOpenDocumentRequest((path) => {
      this.open(path).catch(reportFailure);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.cameBack();
    });
    void this.cameBack();
    await afterFirstFrame();
    await uncoverPage().catch(console.error);
  }

  /** Brings in what other apps shared and what changed the file meanwhile. */
  private async cameBack() {
    const inbox = await drainInbox(i18next.t('mobile.inboxFile')).catch(
      (error) => {
        console.error('[documents] Failed to empty the inbox', error);
        return null;
      }
    );
    await this.files.recheckFile();
    if (inbox && this.library.isOpen()) await this.library.refresh();
  }

  currentPath() {
    return store.getState().filePath;
  }

  async showLibrary() {
    await this.library.show();
    await setCurrentDocument(null).catch(console.error);
  }

  close() {
    const path = this.currentPath();
    if (!path) return;
    this.library.hide();
    void setCurrentDocument(path).catch(console.error);
  }

  async open(path: string) {
    if (path === this.currentPath()) {
      this.close();
      return;
    }
    if (!(await this.files.leaveDocument())) return;
    await downloadDocument(path);
    const bound = await registerWindowDocument(path);
    await noteDocumentOpened(bound);
    await coverPage().catch(console.error);
    window.location.reload();
  }

  async createIn(folder: string) {
    const path = await createDocument(
      folder,
      i18next.t('library.untitled'),
      'md'
    );
    await this.open(path);
  }

  /** File > New: a document in iCloud Drive's NyaMark folder, or the device's. */
  async newDocument() {
    try {
      const locations = await documentLocations();
      const folder =
        locations.find((place) => place.kind === 'icloud' && place.available)
          ?.path ??
        locations.find((place) => place.kind === 'local')?.path ??
        null;
      if (folder) await this.createIn(folder);
    } catch (error) {
      reportFailure(error);
    }
  }

  async rename(path: string, stem: string) {
    if (path !== this.currentPath()) return await renameItem(path, stem);
    if (!(await this.files.leaveDocument())) return path;
    const renamed = await renameItem(path, stem);
    await this.files.adoptRenamedPath(renamed);
    await noteDocumentOpened(this.currentPath() ?? renamed);
    return renamed;
  }

  async remove(path: string) {
    if (path === this.currentPath()) {
      // Saved first, so no save still under way brings the file back.
      if (!(await this.files.leaveDocument())) return;
      this.files.closeDocument();
      await setCurrentDocument(null);
    }
    await deleteItem(path);
  }

  async pickDocument() {
    const path = await pickDocument(MARKDOWN_EXTENSIONS);
    if (path) await this.open(path);
  }

  /** File > Open. */
  async openDocument() {
    await this.pickDocument().catch(reportFailure);
  }

  async renameCurrent() {
    const path = this.currentPath();
    if (path) await this.library.promptRename(path);
  }

  async share(anchor: DOMRect | null) {
    const path = this.currentPath();
    if (!path || !(await this.files.leaveDocument())) return;
    try {
      await shareFile(
        path,
        documentFileName(path),
        anchor && {
          x: anchor.x,
          y: anchor.y,
          width: anchor.width,
          height: anchor.height,
        }
      );
    } catch (error) {
      reportFailure(error);
    }
  }
}
