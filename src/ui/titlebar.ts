import { Store } from '../state/store';
import {
  closeWindow,
  minimizeWindow,
  setWindowTitle,
  toggleMaximizeWindow,
} from '../bridge/ipc/windows';

import { i18next } from '../i18n';

type TitlebarActions = {
  onNewFile: () => Promise<unknown> | void;
  onOpenFile: () => Promise<unknown> | void;
  onSaveFile: () => Promise<unknown> | void;
  onSaveFileAs: () => Promise<unknown> | void;
  onToggleOutline: () => Promise<unknown> | void;
  onOpenSettings: () => void;
};

/**
 * Pure UI binding: forwards button clicks to controller actions and reflects
 * state from the store. Window-chrome behaviour like double-click maximize is
 * handled natively by Tauri via `data-tauri-drag-region`, so we don't carry
 * any of that here.
 */
export class Titlebar {
  private readonly elFilename = document.getElementById(
    'tb-filename'
  ) as HTMLElement;
  private readonly elDirty = document.getElementById('tb-dirty') as HTMLElement;
  private readonly elFileMenuButton = document.getElementById(
    'tb-file-menu-button'
  ) as HTMLButtonElement | null;
  private readonly elFileMenu = document.getElementById(
    'tb-file-menu'
  ) as HTMLDivElement | null;

  constructor(
    private readonly store: Store,
    private readonly actions: TitlebarActions
  ) {
    this.bindFileMenu();
    this.bindAction('tb-outline', this.actions.onToggleOutline);
    this.bindClick('tb-settings', () => this.actions.onOpenSettings());
    this.bindClick(
      'tb-minimize',
      () => void minimizeWindow().catch(console.error)
    );
    this.bindClick(
      'tb-maximize',
      () => void toggleMaximizeWindow().catch(console.error)
    );
    this.bindClick('tb-close', () => void closeWindow().catch(console.error));

    this.store.subscribe((state) => this.update(state));
    i18next.on('languageChanged', () => {
      this.update(this.store.getState());
    });
  }

  private bindFileMenu() {
    if (!this.elFileMenuButton || !this.elFileMenu) return;
    const menuButton = this.elFileMenuButton;
    const menu = this.elFileMenu;

    const setOpen = (open: boolean) => {
      menu.hidden = !open;
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(menu.hidden);
    });

    menu
      .querySelector<HTMLElement>('[data-file-action="new"]')
      ?.addEventListener('click', () => {
        setOpen(false);
        void Promise.resolve(this.actions.onNewFile()).catch(console.error);
      });
    menu
      .querySelector<HTMLElement>('[data-file-action="open"]')
      ?.addEventListener('click', () => {
        setOpen(false);
        void Promise.resolve(this.actions.onOpenFile()).catch(console.error);
      });
    menu
      .querySelector<HTMLElement>('[data-file-action="save"]')
      ?.addEventListener('click', () => {
        setOpen(false);
        void Promise.resolve(this.actions.onSaveFile()).catch(console.error);
      });
    menu
      .querySelector<HTMLElement>('[data-file-action="save-as"]')
      ?.addEventListener('click', () => {
        setOpen(false);
        void Promise.resolve(this.actions.onSaveFileAs()).catch(console.error);
      });

    document.addEventListener('click', (event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menu.contains(target) || menuButton.contains(target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  private bindAction(id: string, handler: () => Promise<unknown> | void) {
    document.getElementById(id)?.addEventListener('click', () => {
      Promise.resolve(handler()).catch(console.error);
    });
  }

  private bindClick(id: string, handler: () => void) {
    document.getElementById(id)?.addEventListener('click', handler);
  }

  private update(state: ReturnType<Store['getState']>) {
    const filename = state.filePath
      ? state.filePath.split('/').pop() ||
        state.filePath.split('\\').pop() ||
        'Untitled.md'
      : 'Untitled.md';
    if (this.elFilename.textContent !== filename) {
      this.elFilename.textContent = filename;
      void setWindowTitle(filename).catch(console.error);
    }
    this.elDirty.style.opacity = state.isDirty ? '1' : '0';
  }
}
