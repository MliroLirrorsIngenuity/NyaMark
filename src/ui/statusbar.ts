import { Store } from '../state/store';
import { i18next } from '../i18n';

export class Statusbar {
  private elWords: HTMLElement;
  private elLines: HTMLElement;
  private elMode: HTMLElement;

  constructor(private store: Store) {
    this.elWords = document.getElementById('sb-words') as HTMLElement;
    this.elLines = document.getElementById('sb-lines') as HTMLElement;
    this.elMode = document.getElementById('sb-mode') as HTMLElement;

    this.store.subscribe((state) => {
      this.update(state);
    });

    i18next.on('languageChanged', () => {
      this.update(this.store.getState());
    });

    this.elMode.addEventListener('click', () => {
      // Toggle source mode later
      const currentMode = this.store.getState().sourceMode;
      this.store.update({ sourceMode: !currentMode });
    });
  }

  private update(state: ReturnType<Store['getState']>) {
    this.elWords.textContent = i18next.t('statusbar.words', { count: state.wordCount });
    this.elLines.textContent = i18next.t('statusbar.line', { line: state.lineCount });
    this.elMode.textContent = state.sourceMode ? 'Source' : 'Markdown';
  }
}
