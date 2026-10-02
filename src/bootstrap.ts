/**
 * Composition root. Builds the app by wiring together small focused
 * modules — no logic of its own beyond glue.
 */

import { errorDialog, warningDialog } from './bridge/ipc/files';
import { checkForUpdate } from './bridge/ipc/updates';
import { isPrimaryWindow } from './bridge/ipc/windows';
import { NyaEditor } from './editor/editor';
import { SourceModeController } from './editor/source-mode';
import { AttachmentController } from './features/attachment-controller';
import { bindAutoSave } from './features/auto-save';
import { CloseGuard } from './features/close-guard';
import { FileController } from './features/file-controller';
import { bindLanguageSetting, syncMacosMenu } from './features/language-sync';
import { MenuController } from './features/menu-controller';
import { PdfExporter } from './features/pdf-export';
import {
  ShortcutController,
  hasPrimaryModifier,
} from './features/shortcut-controller';
import { i18next, initI18n } from './i18n';
import { translateDOM } from './i18n/dom';
import {
  getSettings,
  hydrateSettings,
  reapplyWindowEffects,
  takeUnreadableSettingsBackup,
} from './state/settings';
import { store } from './state/store';
import { OutlinePanel } from './ui/outline';
import { SearchPanel } from './ui/search';
import { SettingsPanel } from './ui/settings-panel/panel';
import { registerShellStyles, renderAppShell } from './ui/shell';
import { Statusbar } from './ui/statusbar';
import { ThemeManager } from './ui/theme';
import { Titlebar } from './ui/titlebar';
import { UpdateDialog } from './ui/update-dialog';

export class App {
  private editor: NyaEditor | null = null;
  private outline: OutlinePanel | null = null;
  private attachments: AttachmentController | null = null;
  private sourceMode: SourceModeController | null = null;
  private suppressDirtyTracking = false;
  private readonly settingsPanel = new SettingsPanel();
  private readonly pdfExporter = new PdfExporter();
  private readonly updateDialog = new UpdateDialog();

  async init() {
    registerShellStyles();

    const appRoot = document.getElementById('ny-app');
    if (!appRoot) {
      void errorDialog('App root not found');
      return;
    }

    // Render the shell immediately so the window has a visible background
    // before any async IPC calls complete.
    renderAppShell(appRoot);

    await hydrateSettings();
    const settings = getSettings();

    await initI18n(settings.general.language);
    bindLanguageSetting(settings.general.language);

    syncMacosMenu();
    translateDOM(document.body);

    const unreadableSettings = takeUnreadableSettingsBackup();
    if (unreadableSettings) {
      void warningDialog(
        i18next.t('dialog.settingsReset.body', { path: unreadableSettings }),
        i18next.t('dialog.settingsReset.title')
      );
    }

    const theme = new ThemeManager();
    window.addEventListener('nyamark:themechange', reapplyWindowEffects);

    const editorContainer = document.getElementById('ny-editor-container');
    if (!editorContainer) {
      void errorDialog('Editor container not found');
      return;
    }

    const fileController = new FileController(() => this.editor, {
      syncEditorAfterSave: (saved) => this.syncEditorAfterSave(saved),
      flushPendingEdits: () => this.sourceMode?.flush(),
    });
    bindAutoSave(() => fileController.autoSaveFile());

    const initialDocument = await fileController.resolveInitialDocument();
    store.update({ filePath: initialDocument.filePath, isDirty: false });

    // Registered before the editor exists so an early close request is never
    // handled by Tauri's default (destroy without asking).
    await new CloseGuard(fileController).bind();

    this.attachments = new AttachmentController({
      getMarkdown: () => this.editor?.getMarkdown() ?? '',
      getDocumentPath: () => store.getState().filePath,
      saveDocumentAs: () => fileController.saveFileAs(),
      insertAttachments: (attachments) =>
        this.editor?.insertAttachments(attachments),
      onAttachmentsInserted: () => {
        this.updateStats();
        store.update({ isDirty: true });
      },
    });

    this.editor = new NyaEditor(editorContainer, {
      onUploadFile: (file) =>
        this.attachments?.upload(file) ?? Promise.resolve(''),
      proxyDomURL: (src) => this.attachments?.resolvePreviewUrl(src) ?? src,
    });

    await this.editor.init(initialDocument.markdown);
    // Dirty state comes from onDocChanged alone. The debounced onChange can
    // land after a save that already captured the latest keystroke.
    this.editor.onChange((markdown) => this.updateStats(markdown));
    this.editor.onDocChanged(() => this.markDirty());

    this.sourceMode = new SourceModeController(
      editorContainer,
      this.editor,
      store
    );
    this.sourceMode.init();

    this.attachments.bindPaste(editorContainer);
    this.attachments.bindImagePicker(editorContainer);
    void this.attachments.bindWindowFileDrop();

    editorContainer.addEventListener('click', (e) => {
      // Cmd-click (Ctrl-click elsewhere) opens links/attachments without
      // hijacking normal edit clicks that place the caret inside the link.
      if (!hasPrimaryModifier(e)) return;
      const target = e.target as HTMLElement | null;
      const href = target?.closest('a[href]')?.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      // A link into the document goes to its heading: opened as a file, it
      // named one in the document's folder, called after the anchor.
      if (href.startsWith('#')) {
        this.editor?.scrollToAnchor(href.slice(1));
        return;
      }
      void this.attachments?.openLinkedResource(href);
    });

    new Titlebar(store, {
      onNewFile: () => fileController.newFile(),
      onOpenFile: () => fileController.openFile(),
      onSaveFile: () => fileController.saveFile(),
      onSaveFileAs: () => fileController.saveFileAs(),
      onExportPdf: () => this.pdfExporter.open(),
      onToggleOutline: () => this.toggleOutline(),
      onOpenSettings: () => this.settingsPanel.open(),
    });

    new Statusbar(store, theme);
    const searchPanel = new SearchPanel(() => this.editor);
    // The preview's find bar has no place beside the source pane, which has
    // one of its own: left open, it searched the preview and, closed, put
    // the caret there, where typing was lost to the next source edit.
    store.subscribe((state) => {
      if (state.sourceMode) searchPanel.hide();
    });

    const menuController = new MenuController({
      'new-file': () => fileController.newFile(),
      'open-file': () => fileController.openFile(),
      'save-file': () => fileController.saveFile(),
      'save-file-as': () => fileController.saveFileAs(),
      'export-pdf': () => this.pdfExporter.open(),
      'open-settings': () => this.settingsPanel.open(),
    });
    void menuController.bind();

    const shortcutController = new ShortcutController({
      newFile: () => fileController.newFile(),
      openFile: () => fileController.openFile(),
      saveFile: () => fileController.saveFile(),
      saveFileAs: () => fileController.saveFileAs(),
      print: () => this.pdfExporter.open(),
      find: () => {
        if (!this.sourceMode?.find()) searchPanel.show();
      },
      toggleOutline: () => this.toggleOutline(),
      openSettings: () => this.settingsPanel.open(),
    });
    shortcutController.bind();

    this.refreshStatsSoon();
    this.scheduleUpdateCheck();
    // A new window is opened to write in; the caret starts at the top.
    this.editor.focus();
  }

  private toggleOutline() {
    if (!this.editor) return;
    const editor = this.editor;
    this.outline ??= new OutlinePanel(editor, (id) => {
      if (!this.sourceMode?.revealHeading(id)) editor.scrollToHeading(id);
    });
    this.outline.toggle();
  }

  private scheduleUpdateCheck() {
    // A dev build reports version 0.0.0 and would offer to replace itself
    // with the latest release on every launch.
    if (import.meta.env.DEV) return;
    window.setTimeout(() => {
      void this.checkForUpdates().catch((error) => {
        console.error('[updates] Update check failed', error);
      });
    }, 1200);
  }

  private async checkForUpdates() {
    if (!(await isPrimaryWindow())) return;
    const update = await checkForUpdate();
    if (update) {
      this.updateDialog.open(update);
    }
  }

  private syncEditorAfterSave(savedContent: string) {
    if (!this.editor) return;
    if (savedContent !== this.editor.getMarkdown()) {
      this.suppressDirtyTracking = true;
      try {
        this.editor.setMarkdown(savedContent, { addToHistory: false });
      } finally {
        this.suppressDirtyTracking = false;
      }
      // A stale source pane would write the pre-reload text back on exit.
      // Left as typed otherwise: rewritten after every save, it lost the
      // keys pressed while the file was written, and its caret.
      this.sourceMode?.refreshFromEditor();
    }
    this.refreshStatsSoon();
  }

  private markDirty() {
    if (this.suppressDirtyTracking || store.getState().isDirty) return;
    store.update({ isDirty: true });
  }

  private updateStats(markdown?: string) {
    if (!this.editor) return;
    const stats = this.editor.getStats(markdown);
    store.update({ wordCount: stats.words, lineCount: stats.lines });
  }

  private refreshStatsSoon() {
    this.updateStats();
    queueMicrotask(() => this.updateStats());
  }
}
