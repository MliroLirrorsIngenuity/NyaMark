/**
 * Composition root. Builds the app by wiring together small focused
 * modules — no logic of its own beyond glue.
 */

import { NyaEditor } from './editor/editor';
import { SourceModeController } from './editor/source-mode';
import { AttachmentController } from './features/attachment-controller';
import { FileController } from './features/file-controller';
import { MenuController } from './features/menu-controller';
import { ShortcutController } from './features/shortcut-controller';
import { store } from './state/store';
import { hydrateSettings } from './state/settings';
import { OutlinePanel } from './ui/outline';
import { SearchPanel } from './ui/search';
import { renderAppShell, registerShellStyles } from './ui/shell';
import { SettingsPanel } from './ui/settings-panel/panel';
import { Statusbar } from './ui/statusbar';
import { ThemeManager, type ThemeMode } from './ui/theme';
import { Titlebar } from './ui/titlebar';

export class App {
  private editor: NyaEditor | null = null;
  private outline: OutlinePanel | null = null;
  private attachments: AttachmentController | null = null;
  private fileController: FileController | null = null;
  private sourceMode: SourceModeController | null = null;
  private suppressDirtyTracking = false;
  private theme: ThemeManager | null = null;
  private readonly settingsPanel = new SettingsPanel();

  async init() {
    registerShellStyles();
    await hydrateSettings();

    const appRoot = document.getElementById('app');
    if (!appRoot) {
      console.error('App root not found');
      return;
    }

    renderAppShell(appRoot);
    this.theme = new ThemeManager();
    this.bindThemeToggle();

    const editorContainer = document.getElementById('editor-container');
    if (!editorContainer) {
      console.error('Editor container not found');
      return;
    }

    this.fileController = new FileController(() => this.editor, {
      syncEditorAfterSave: (saved) => this.syncEditorAfterSave(saved),
    });

    const initialDocument = await this.fileController.resolveInitialDocument();
    store.update({ filePath: initialDocument.filePath, isDirty: false });

    this.attachments = new AttachmentController({
      getMarkdown: () => this.editor?.getMarkdown() ?? '',
      getDocumentPath: () => store.getState().filePath,
      saveDocumentAs: () => this.fileController!.saveFileAs(),
      insertAttachments: (attachments) => this.editor?.insertAttachments(attachments),
      onAttachmentsInserted: () => {
        this.updateStats();
        store.update({ isDirty: true });
      },
    });

    this.editor = new NyaEditor(editorContainer, {
      onUploadFile: (file) => this.attachments?.upload(file) ?? Promise.resolve(''),
      proxyDomURL: (src) => this.attachments?.resolvePreviewUrl(src) ?? src,
    });

    await this.editor.init(initialDocument.markdown);

    new Titlebar(store, {
      onNewFile: () => this.fileController!.newFile(),
      onOpenFile: () => this.fileController!.openFile(),
      onSaveFile: () => this.fileController!.saveFile(),
      onToggleOutline: async () => this.outline?.toggle(),
      onOpenSettings: () => this.settingsPanel.open(),
    });
    new Statusbar(store);
    new SearchPanel();

    this.outline = new OutlinePanel(this.editor);
    this.sourceMode = new SourceModeController(editorContainer, this.editor, store);
    this.sourceMode.init();

    this.bindBlankDocumentFocus();
    this.attachments.bindPaste(editorContainer);
    await this.attachments.bindWindowFileDrop();
    this.bindLocalLinkHandling(editorContainer);
    this.refreshStatsSoon();

    let isInitialLoad = true;
    this.editor.onChange(() => {
      if (isInitialLoad || this.suppressDirtyTracking) {
        isInitialLoad = false;
        return;
      }
      this.updateStats();
      store.update({ isDirty: true });
    });

    new ShortcutController({
      newFile: () => this.fileController!.newFile(),
      openFile: () => this.fileController!.openFile(),
      saveFile: () => this.fileController!.saveFile(),
      saveFileAs: () => this.fileController!.saveFileAs(),
      print: () => window.print(),
    }).bind();

    await new MenuController({
      'new-file': () => void this.fileController!.newFile(),
      'open-file': () => void this.fileController!.openFile(),
      'save-file': () => void this.fileController!.saveFile(),
      'open-settings': () => this.settingsPanel.open(),
    }).bind();
  }

  private updateStats() {
    if (!this.editor) return;
    const stats = this.editor.getStats();
    store.update({ wordCount: stats.words, lineCount: stats.lines });
  }

  private bindBlankDocumentFocus() {
    const shellBody = document.querySelector('.ny-shell__body') as HTMLElement | null;
    if (!shellBody) return;

    shellBody.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.editor) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (
        target.closest(
          '.milkdown-top-bar, .milkdown-toolbar, .milkdown-slash-menu, .milkdown-block-handle, .ny-outline, .ny-search, .ny-source-pane, button, a, input, select, textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }

      if (!this.shouldFocusEditorEnd(target, event.clientX, event.clientY)) {
        return;
      }

      event.preventDefault();
      this.editor.focusAtEnd();
    });
  }

  private bindLocalLinkHandling(editorContainer: HTMLElement) {
    editorContainer.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        void this.attachments?.openLinkedResource(anchor.getAttribute('href') ?? '');
      },
      true
    );
  }

  private shouldFocusEditorEnd(target: HTMLElement, clientX: number, clientY: number) {
    const editorFrame = document.getElementById('editor-container');
    const editorSurface = document.querySelector('.milkdown .editor') as HTMLElement | null;
    if (!editorFrame || !editorSurface) return false;

    const frameRect = editorFrame.getBoundingClientRect();
    if (clientX < frameRect.left || clientX > frameRect.right) return false;

    if (this.editor?.isEmpty()) {
      return clientY >= frameRect.top;
    }

    const lastContent = Array.from(editorSurface.children)
      .reverse()
      .find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.getBoundingClientRect().height > 0
      );

    if (!lastContent) return false;
    const lastRect = lastContent.getBoundingClientRect();
    const clickedInsideContent =
      editorSurface.contains(target) && clientY <= lastRect.bottom + 4;
    if (clickedInsideContent) return false;
    return clientY > lastRect.bottom + 4;
  }

  private bindThemeToggle() {
    const elTheme = document.getElementById('sb-theme');
    if (!elTheme || !this.theme) return;

    this.theme.onChange((mode) => this.updateThemeLabel(elTheme, mode));
    elTheme.addEventListener('click', () => this.theme?.toggle());
  }

  private updateThemeLabel(elTheme: HTMLElement, mode: ThemeMode) {
    const label = mode === 'dark' ? 'Dark' : 'Light';
    elTheme.textContent = label;
    elTheme.setAttribute('aria-label', `Switch theme mode, current ${label.toLowerCase()}`);
    elTheme.setAttribute(
      'title',
      `Current ${mode}. Updates automatically when the system theme changes.`
    );
  }

  private syncEditorAfterSave(savedContent: string) {
    if (!this.editor || savedContent === this.editor.getMarkdown()) return;
    this.suppressDirtyTracking = true;
    this.editor.setMarkdown(savedContent);
    queueMicrotask(() => {
      this.suppressDirtyTracking = false;
      this.refreshStatsSoon();
    });
  }

  private refreshStatsSoon() {
    this.updateStats();
    queueMicrotask(() => this.updateStats());
    requestAnimationFrame(() => this.updateStats());
    window.setTimeout(() => this.updateStats(), 80);
  }
}
