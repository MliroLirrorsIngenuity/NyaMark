import { i18next } from '../i18n';
import type { Store } from '../state/store';
import { requireElement } from './require-element';
import type { ThemeManager, ThemeMode } from './theme';

export class Statusbar {
  private elWords: HTMLElement;
  private elLines: HTMLElement;
  private elMode: HTMLElement;
  private elTheme: HTMLElement;

  constructor(
    private store: Store,
    private theme: ThemeManager
  ) {
    this.elWords = requireElement(document, '#sb-words');
    this.elLines = requireElement(document, '#sb-lines');
    this.elMode = requireElement(document, '#sb-mode');
    this.elTheme = requireElement(document, '#sb-theme');

    this.store.subscribe((state) => {
      this.update(state);
    });
    this.theme.onChange((mode) => this.updateTheme(mode));

    i18next.on('languageChanged', () => {
      this.update(this.store.getState());
      this.updateTheme(this.theme.getMode());
    });

    this.elMode.addEventListener('click', () => {
      const currentMode = this.store.getState().sourceMode;
      this.store.update({ sourceMode: !currentMode });
    });
    this.elTheme.addEventListener('click', () => this.theme.toggle());
  }

  private update(state: ReturnType<Store['getState']>) {
    this.elWords.textContent = i18next.t('statusbar.words', {
      count: state.wordCount,
    });
    this.elLines.textContent = i18next.t('statusbar.lines', {
      count: state.lineCount,
    });
    this.elMode.textContent = i18next.t(
      state.sourceMode ? 'statusbar.modeSource' : 'statusbar.modeMarkdown'
    );
    this.elMode.setAttribute('aria-pressed', String(state.sourceMode));
  }

  /**
   * The title names the mode in the interface's language and says whether it
   * follows the system. It gave the mode's code, "dark" in a Chinese
   * sentence, and said it followed the system after a click had chosen one.
   */
  private updateTheme(mode: ThemeMode) {
    const dark = i18next.t('statusbar.themeDark');
    const light = i18next.t('statusbar.themeLight');
    const label = mode === 'dark' ? dark : light;
    this.elTheme.textContent = label;
    this.elTheme.setAttribute(
      'aria-label',
      i18next.t('statusbar.themeAriaLabel', { label: label.toLowerCase() })
    );
    this.elTheme.setAttribute(
      'title',
      i18next.t(
        this.theme.followsSystem()
          ? 'statusbar.themeTitleAuto'
          : 'statusbar.themeTitle',
        { label, next: mode === 'dark' ? light : dark }
      )
    );
  }
}
