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
import { check } from '@tauri-apps/plugin-updater';
import { store } from './state/store';
import {
  getSettings,
  hasPersistedLanguage,
  hydrateSettings,
  previewAppearance,
  subscribeSettings,
  updateSettings,
} from './state/settings';
import { initI18n, i18next, resolveLanguage } from './i18n';
import { translateDOM } from './i18n/dom';
import { updateMacosMenu } from './bridge/ipc/menu';
import { OutlinePanel } from './ui/outline';
import { SearchPanel } from './ui/search';
import {
  type ExportPdfSettings,
  ExportPdfDialog,
} from './ui/export-pdf-dialog';
import { renderAppShell, registerShellStyles } from './ui/shell';
import { SettingsPanel } from './ui/settings-panel/panel';
import { Statusbar } from './ui/statusbar';
import { ThemeManager, type ThemeMode } from './ui/theme';
import { Titlebar } from './ui/titlebar';
import { UpdateDialog } from './ui/update-dialog';
import { printCurrentWindow } from './bridge/ipc/windows';

export class App {
  private editor: NyaEditor | null = null;
  private outline: OutlinePanel | null = null;
  private attachments: AttachmentController | null = null;
  private fileController: FileController | null = null;
  private sourceMode: SourceModeController | null = null;
  private suppressDirtyTracking = false;
  private theme: ThemeManager | null = null;
  private readonly settingsPanel = new SettingsPanel();
  private readonly exportPdfDialog = new ExportPdfDialog();
  private readonly updateDialog = new UpdateDialog();
  private autoSaveEnabled = false;
  private autoSaveIntervalMs = 60_000;
  private autoSaveTimer: number | null = null;
  private currentLanguage = 'en';

  async init() {
    registerShellStyles();
    await hydrateSettings();
    const settings = getSettings();

    if (!(await hasPersistedLanguage())) {
      const detected = resolveLanguage('auto');
      await updateSettings({ general: { language: detected } });
      this.currentLanguage = detected;
    } else {
      this.currentLanguage = settings.general.language;
    }

    await initI18n(this.currentLanguage);

    if (
      document.documentElement.dataset.platform === 'macos' ||
      /Mac/.test(navigator.platform)
    ) {
      void updateMacosMenu(
        i18next.getResourceBundle(i18next.language, 'translation').menu
      );
    }

    const appRoot = document.getElementById('app');
    if (!appRoot) {
      console.error('App root not found');
      return;
    }

    renderAppShell(appRoot);
    translateDOM(document.body);
    this.theme = new ThemeManager();
    this.bindThemeToggle();
    this.bindAutoSave();
    window.addEventListener('nyamark:themechange', () => {
      previewAppearance(getSettings().appearance);
    });

    subscribeSettings((newSettings) => {
      if (newSettings.general.language !== this.currentLanguage) {
        this.currentLanguage = newSettings.general.language;
        i18next.changeLanguage(this.currentLanguage).then(() => {
          translateDOM(document.body);
          if (
            document.documentElement.dataset.platform === 'macos' ||
            /Mac/.test(navigator.platform)
          ) {
            void updateMacosMenu(
              i18next.getResourceBundle(i18next.language, 'translation').menu
            );
          }
        });
      }
    });

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
    this.editor.onChange(() => this.handleEditorChange());

    this.sourceMode = new SourceModeController(
      editorContainer,
      this.editor,
      store
    );
    this.sourceMode.init();

    this.attachments.bindPaste(editorContainer);
    void this.attachments.bindWindowFileDrop();

    editorContainer.addEventListener('click', (e) => {
      if (e.target === editorContainer) {
        this.editor?.focusAtEnd();
        return;
      }

      // Ctrl/Cmd-click opens links/attachments without hijacking normal
      // edit clicks that place the caret inside the link text.
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const href = target?.closest('a[href]')?.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      void this.attachments?.openLinkedResource(href);
    });

    new Titlebar(store, {
      onNewFile: () => this.fileController!.newFile(),
      onOpenFile: () => this.fileController!.openFile(),
      onSaveFile: () => this.fileController!.saveFile(),
      onSaveFileAs: () => this.fileController!.saveFileAs(),
      onExportPdf: () => this.openExportPdfDialog(),
      onToggleOutline: () => {
        if (!this.outline) {
          this.outline = new OutlinePanel(this.editor!);
        }
        this.outline.toggle();
      },
      onOpenSettings: () => this.settingsPanel.open(),
    });

    new Statusbar(store);
    new SearchPanel();

    const menuController = new MenuController({
      'new-file': () => this.fileController!.newFile(),
      'open-file': () => this.fileController!.openFile(),
      'save-file': () => this.fileController!.saveFile(),
      'save-file-as': () => this.fileController!.saveFileAs(),
      'export-pdf': () => this.openExportPdfDialog(),
      'open-settings': () => this.settingsPanel.open(),
    });
    void menuController.bind();

    const shortcutController = new ShortcutController({
      newFile: () => this.fileController!.newFile(),
      openFile: () => this.fileController!.openFile(),
      saveFile: () => this.fileController!.saveFile(),
      saveFileAs: () => this.fileController!.saveFileAs(),
      print: () => this.openExportPdfDialog(),
    });
    shortcutController.bind();

    this.refreshStatsSoon();

    this.updateStats();
    this.scheduleUpdateCheck();
  }

  private scheduleUpdateCheck() {
    window.setTimeout(() => {
      void this.checkForUpdates().catch((error) => {
        console.error('[updates] Update check failed', error);
      });
    }, 1200);
  }

  private async checkForUpdates() {
    const update = await check();
    if (update) {
      this.updateDialog.open(update);
    }
  }

  private bindAutoSave() {
    subscribeSettings((settings) => {
      this.autoSaveEnabled = settings.save.autoSave;
      this.autoSaveIntervalMs = settings.save.autoSaveIntervalMs;
      this.syncAutoSave();
    });
  }

  private syncAutoSave() {
    this.clearAutoSaveTimer();
    if (!this.autoSaveEnabled) return;

    this.autoSaveTimer = window.setTimeout(async () => {
      this.autoSaveTimer = null;
      try {
        await this.fileController?.autoSaveFile();
      } finally {
        this.syncAutoSave();
      }
    }, this.autoSaveIntervalMs);
  }

  private bindThemeToggle() {
    const elTheme = document.getElementById('sb-theme');
    if (!elTheme || !this.theme) return;

    this.theme.onChange((mode) => this.updateThemeLabel(elTheme, mode));
    elTheme.addEventListener('click', () => this.theme?.toggle());

    i18next.on('languageChanged', () => {
      if (this.theme) {
        this.updateThemeLabel(elTheme, this.theme.getMode());
      }
    });
  }

  private updateThemeLabel(elTheme: HTMLElement, mode: ThemeMode) {
    const label =
      mode === 'dark'
        ? i18next.t('statusbar.themeDark')
        : i18next.t('statusbar.themeLight');
    elTheme.textContent = label;
    elTheme.setAttribute(
      'aria-label',
      i18next.t('statusbar.themeAriaLabel', { label: label.toLowerCase() })
    );
    elTheme.setAttribute('title', i18next.t('statusbar.themeTitle', { mode }));
  }

  private syncEditorAfterSave(savedContent: string) {
    if (!this.editor || savedContent === this.editor.getMarkdown()) return;
    this.suppressDirtyTracking = true;
    try {
      this.editor.setMarkdown(savedContent);
    } finally {
      this.suppressDirtyTracking = false;
    }
    this.refreshStatsSoon();
  }

  private handleEditorChange() {
    if (this.suppressDirtyTracking) {
      this.refreshStatsSoon();
      return;
    }

    const stats = this.editor?.getStats() ?? { words: 0, lines: 1 };
    store.update({
      wordCount: stats.words,
      lineCount: stats.lines,
      isDirty: true,
    });
  }

  private updateStats() {
    if (!this.editor) return;
    const stats = this.editor.getStats();
    store.update({
      wordCount: stats.words,
      lineCount: stats.lines,
      isDirty: this.suppressDirtyTracking ? false : store.getState().isDirty,
    });
  }

  private refreshStatsSoon() {
    this.updateStats();
    queueMicrotask(() => this.updateStats());
  }

  private clearAutoSaveTimer() {
    if (this.autoSaveTimer === null) return;
    window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  private getPrintableFileTitle() {
    const filePath = store.getState().filePath;
    const fallback = 'Untitled';
    if (!filePath) return fallback;

    const fileName = filePath.split(/[\\/]/).filter(Boolean).pop();
    if (!fileName) return fallback;

    return fileName.replace(/\.[^./\\]+$/, '') || fallback;
  }

  private async openExportPdfDialog() {
    const settings = await this.exportPdfDialog.open({
      fileName: this.getPrintableFileTitle(),
    });
    if (!settings) return;

    await this.exportAsPdf(settings);
  }

  private async exportAsPdf(settings: ExportPdfSettings) {
    const previousSourceMode = store.getState().sourceMode;
    if (previousSourceMode) {
      store.update({ sourceMode: false });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }

    const root = document.documentElement;
    root.classList.add('ny-exporting-pdf');

    const previousZoom = document.body.style.zoom;
    const printStyle = document.createElement('style');
    printStyle.id = 'ny-print-export-style';
    printStyle.textContent = this.buildPrintStyle(settings);
    document.head.appendChild(printStyle);

    if (settings.downscalePercent !== 100) {
      document.body.style.zoom = String(settings.downscalePercent / 100);
    } else {
      document.body.style.zoom = '';
    }

    const cleanup = () => {
      printStyle.remove();
      document.body.style.zoom = previousZoom;
      root.classList.remove('ny-exporting-pdf');
      if (previousSourceMode) {
        store.update({ sourceMode: true });
      }
    };

    const handleAfterPrint = () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      cleanup();
    };

    const printCompleted = new Promise<void>((resolve) => {
      window.addEventListener('afterprint', () => resolve(), { once: true });
    });

    window.addEventListener('afterprint', handleAfterPrint);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    try {
      await printCurrentWindow();
      await Promise.race([
        printCompleted,
        new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 15000);
        }),
      ]);
    } catch (error) {
      window.removeEventListener('afterprint', handleAfterPrint);
      cleanup();
      console.warn(
        '[export] Native print failed, falling back to browser print',
        error
      );
      window.print();
      cleanup();
    }
  }

  private buildPrintStyle(settings: ExportPdfSettings) {
    const marginValue =
      settings.margin === 'none'
        ? '0'
        : settings.margin === 'narrow'
          ? '8mm'
          : settings.margin === 'wide'
            ? '24mm'
            : '16mm';
    const pageSize = settings.pageSize.toLowerCase();
    const orientation = settings.landscape ? 'landscape' : 'portrait';

    return `
      @page {
        size: ${pageSize} ${orientation};
        margin: ${marginValue};
      }

      @media print {
        body > *:not(#app) {
          display: none !important;
        }

        :root.ny-exporting-pdf #app > :not(.ny-shell__body),
        :root.ny-exporting-pdf .ny-shell__body > :not(#editor-container) {
          display: none !important;
        }

        html,
        body,
        #app,
        #app.ny-shell {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          background: #fff !important;
          color: #111 !important;
          border-radius: 0 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        :root.ny-exporting-pdf #titlebar,
        :root.ny-exporting-pdf #statusbar,
        :root.ny-exporting-pdf .ny-shell__resize-handle,
        :root.ny-exporting-pdf .ny-shell__window-controls,
        :root.ny-exporting-pdf .ny-shell__title-leading,
        :root.ny-exporting-pdf .ny-shell__title-actions,
        :root.ny-exporting-pdf .ny-shell__file-menu,
        :root.ny-exporting-pdf .ny-settings-overlay,
        :root.ny-exporting-pdf .ny-update-overlay,
        :root.ny-exporting-pdf .ny-image-policy-overlay,
        :root.ny-exporting-pdf .ny-search,
        :root.ny-exporting-pdf .ny-outline,
        :root.ny-exporting-pdf .ny-export-pdf-overlay,
        :root.ny-exporting-pdf .ny-shell__body > .ny-shell__overlay,
        :root.ny-exporting-pdf .ny-shell__body [data-tauri-drag-region] {
          display: none !important;
        }

        :root.ny-exporting-pdf .ny-shell__body,
        :root.ny-exporting-pdf #editor-container,
        :root.ny-exporting-pdf .ny-shell__body.is-source-mode-host,
        :root.ny-exporting-pdf .milkdown,
        :root.ny-exporting-pdf .milkdown .editor,
        :root.ny-exporting-pdf .milkdown .ProseMirror {
          overflow: visible !important;
          max-width: none !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        :root.ny-exporting-pdf #editor-container {
          display: block !important;
          height: auto !important;
          min-height: 0 !important;
        }

        :root.ny-exporting-pdf .ny-source-pane,
        :root.ny-exporting-pdf .nyamark-image-meta,
        :root.ny-exporting-pdf .nyamark-image-meta-toggle,
        :root.ny-exporting-pdf .nyamark-image-meta-open .nyamark-image-meta,
        :root.ny-exporting-pdf .milkdown .milkdown-top-bar,
        :root.ny-exporting-pdf .milkdown .milkdown-toolbar,
        :root.ny-exporting-pdf .milkdown .toolbar,
        :root.ny-exporting-pdf .milkdown .top-bar,
        :root.ny-exporting-pdf .milkdown .milkdown-code-block .tools {
          display: none !important;
        }

        :root.ny-exporting-pdf .milkdown .editor {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        :root.ny-exporting-pdf .milkdown .ProseMirror {
          user-select: text !important;
          cursor: default !important;
          pointer-events: none !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }

        :root.ny-exporting-pdf .milkdown pre,
        :root.ny-exporting-pdf .milkdown blockquote,
        :root.ny-exporting-pdf .milkdown table,
        :root.ny-exporting-pdf .milkdown img,
        :root.ny-exporting-pdf .milkdown .mermaid,
        :root.ny-exporting-pdf .milkdown .milkdown-code-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        :root.ny-exporting-pdf .milkdown h1,
        :root.ny-exporting-pdf .milkdown h2,
        :root.ny-exporting-pdf .milkdown h3,
        :root.ny-exporting-pdf .milkdown h4,
        :root.ny-exporting-pdf .milkdown h5,
        :root.ny-exporting-pdf .milkdown h6 {
          break-after: avoid;
          page-break-after: avoid;
        }
      }
    `;
  }
}
