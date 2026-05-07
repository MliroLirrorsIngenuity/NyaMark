export interface AppState {
  filePath: string | null;
  isDirty: boolean;
  wordCount: number;
  lineCount: number;
  sourceMode: boolean;
}

type Listener = (state: AppState) => void;

export class Store {
  private state: AppState = {
    filePath: null,
    isDirty: false,
    wordCount: 0,
    lineCount: 1,
    sourceMode: false,
  };

  private listeners: Listener[] = [];

  getState(): AppState {
    return this.state;
  }

  update(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    listener(this.state); // Notify immediately upon subscription
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const store = new Store();
