import { Store } from '../state/store';
import { closeWindow, minimizeWindow, setWindowTitle, toggleMaximizeWindow } from '../bridge/ipc/windows';

type TitlebarActions = {
  onNewFile: () => Promise<void>;
  onOpenFile: () => Promise<void>;
  onSaveFile: () => Promise<void>;
  onToggleOutline: () => Promise<void>;
  onOpenSettings: () => void;
};

/**
 * Pure UI binding: forwards button clicks to controller actions and reflects
 * state from the store. Window-chrome behaviour like double-click maximize is
 * handled natively by Tauri via `data-tauri-drag-region`, so we don't carry
 * any of that here.
 */
export class Titlebar {
  private readonly elFilename = document.getElementById('tb-filename') as HTMLElement;
  private readonly elDirty = document.getElementById('tb-dirty') as HTMLElement;

  constructor(private readonly store: Store, private readonly actions: TitlebarActions) {
    this.bindAction('tb-new', this.actions.onNewFile);
    this.bindAction('tb-open', this.actions.onOpenFile);
    this.bindAction('tb-save', this.actions.onSaveFile);
    this.bindAction('tb-outline', this.actions.onToggleOutline);
    this.bindClick('tb-settings', () => this.actions.onOpenSettings());
    this.bindClick('tb-minimize', () => void minimizeWindow().catch(console.error));
    this.bindClick('tb-maximize', () => void toggleMaximizeWindow().catch(console.error));
    this.bindClick('tb-close', () => void closeWindow().catch(console.error));

    this.store.subscribe((state) => this.update(state));
  }

  private bindAction(id: string, handler: () => Promise<void>) {
    document.getElementById(id)?.addEventListener('click', () => {
      handler().catch(console.error);
    });
  }

  private bindClick(id: string, handler: () => void) {
    document.getElementById(id)?.addEventListener('click', handler);
  }

  private update(state: ReturnType<Store['getState']>) {
    const filename = state.filePath
      ? state.filePath.split('/').pop() || state.filePath.split('\\').pop() || 'Untitled.md'
      : 'Untitled.md';
    if (this.elFilename.textContent !== filename) {
      this.elFilename.textContent = filename;
      void setWindowTitle(filename).catch(console.error);
    }
    this.elDirty.style.opacity = state.isDirty ? '1' : '0';
  }
}
