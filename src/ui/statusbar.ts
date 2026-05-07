import { Store } from '../state/store';

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

    this.elMode.addEventListener('click', () => {
      // Toggle source mode later
      const currentMode = this.store.getState().sourceMode;
      this.store.update({ sourceMode: !currentMode });
    });
  }

  private update(state: ReturnType<Store['getState']>) {
    this.elWords.textContent = `${state.wordCount} words`;
    this.elLines.textContent = `Line ${state.lineCount}`;
    this.elMode.textContent = state.sourceMode ? 'Source' : 'Markdown';
  }
}
