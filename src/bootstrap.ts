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
import { getSettings, hydrateSettings, subscribeSettings, updateSettings } from './state/settings';
import { initI18n, i18next, resolveLanguage } from './i18n';
import { translateDOM } from './i18n/dom';
import { updateMacosMenu } from './bridge/ipc/menu';
import { invoke } from '@tauri-apps/api/core';
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
  private autoSaveEnabled = false;
  private autoSaveIntervalMs = 60_000;
  private autoSaveTimer: number | null = null;
  private currentLanguage = 'en';

  private async hasSavedLanguage(): Promise<boolean> {
    try {
      const raw = await invoke<string | null>('load_settings_raw');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!(parsed?.general?.language);
    } catch {
      return false;
    }
  }

  async init() {
    registerShellStyles();
    await hydrateSettings();
    const settings = getSettings();

    if (!(await this.hasSavedLanguage())) {
      const detected = resolveLanguage('auto');
      await updateSettings({ general: { language: detected } });
      this.currentLanguage = detected;
    } else {
      this.currentLanguage = settings.general.language;
    }

    await initI18n(this.currentLanguage);

    if (document.documentElement.dataset.platform === 'macos' || /Mac/.test(navigator.platform)) {
      void updateMacosMenu(i18next.getResourceBundle(i18next.language, 'translation').menu);
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

    subscribeSettings((newSettings) => {
      if (newSettings.general.language !== this.currentLanguage) {
        this.currentLanguage = newSettings.general.language;
        i18next.changeLanguage(this.currentLanguage).then(() => {
          translateDOM(document.body);
          if (document.documentElement.dataset.platform === 'macos' || /Mac/.test(navigator.platform)) {
            void updateMacosMenu(i18next.getResourceBundle(i18next.language, 'translation').menu);
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

    this.sourceMode = new SourceModeController(editorContainer, this.editor, store);
    this.sourceMode.init();

    editorContainer.addEventListener('click', (e) => {
      if (e.target === editorContainer) {
        this.editor?.focusAtEnd();
      }
    });

    new Titlebar(store, {
      onNewFile: () => this.fileController!.newFile(),
      onOpenFile: () => this.fileController!.openFile(),
      onSaveFile: () => this.fileController!.saveFile(),
      onSaveFileAs: () => this.fileController!.saveFileAs(),
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
      'open-settings': () => this.settingsPanel.open(),
    });
    void menuController.bind();

    const shortcutController = new ShortcutController({
      newFile: () => this.fileController!.newFile(),
      openFile: () => this.fileController!.openFile(),
      saveFile: () => this.fileController!.saveFile(),
      saveFileAs: () => this.fileController!.saveFileAs(),
      print: () => {
        window.print();
      },
    });
    shortcutController.bind();

    this.refreshStatsSoon();

    this.updateStats();
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
    const label = mode === 'dark' ? i18next.t('statusbar.themeDark') : i18next.t('statusbar.themeLight');
    elTheme.textContent = label;
    elTheme.setAttribute(
      'aria-label',
      i18next.t('statusbar.themeAriaLabel', { label: label.toLowerCase() })
    );
    elTheme.setAttribute(
      'title',
      i18next.t('statusbar.themeTitle', { mode })
    );
  }

  private syncEditorAfterSave(savedContent: string) {
    if (!this.editor || savedContent === this.editor.getMarkdown()) return;
    this.editor.setMarkdown(savedContent);
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
}
