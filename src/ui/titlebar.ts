import {
  closeWindow,
  isWindowMaximized,
  listenWindowResize,
  minimizeWindow,
  setWindowTitle,
  startWindowDrag,
  toggleMaximizeWindow,
  unmaximizeWindow,
} from '../bridge/ipc/windows';
import type { Store } from '../state/store';

import { i18next } from '../i18n';
import { isMacOS } from '../platform/detect';
import { documentFileName } from './document-name';
import { pushEscapeLayer } from './escape-layers';

type TitlebarActions = {
  onNewFile: () => unknown;
  onOpenFile: () => unknown;
  onSaveFile: () => unknown;
  onSaveFileAs: () => unknown;
  onExportPdf: () => unknown;
  onToggleOutline: () => unknown;
  onOpenSettings: () => void;
};

/** How far the pointer moves on the title bar before the window follows it. */
const TITLEBAR_DRAG_DISTANCE = 4;

/**
 * Pure UI binding: forwards button clicks to controller actions and reflects
 * state from the store. On macOS Tauri's drag region moves the window.
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
    this.bindWindowChromeRestore();
    this.bindMaximizeState();
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

  private bindWindowChromeRestore() {
    const titlebar = document.getElementById('ny-titlebar') as HTMLElement;
    const isTitlebarClick = (event: MouseEvent) =>
      event.button === 0 && event.target === titlebar;

    if (!isMacOS()) {
      this.bindTitlebarDrag(titlebar, isTitlebarClick);
      return;
    }

    let maximizedBeforeClick: Promise<boolean> | null = null;

    titlebar.addEventListener(
      'mousedown',
      (event) => {
        if (isTitlebarClick(event) && event.detail === 1) {
          maximizedBeforeClick = isWindowMaximized().catch((error) => {
            console.error(error);
            return false;
          });
        }
      },
      true
    );

    titlebar.addEventListener(
      'mouseup',
      (event) => {
        if (
          !isTitlebarClick(event) ||
          event.detail !== 2 ||
          maximizedBeforeClick === null
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const wasMaximized = maximizedBeforeClick;
        maximizedBeforeClick = null;
        void wasMaximized
          .then((maximized) =>
            maximized ? unmaximizeWindow() : toggleMaximizeWindow()
          )
          .catch(console.error);
      },
      true
    );
  }

  /**
   * Windows and Linux: maximized, the window's maximize button turns into
   * restore, as the system's does, and the shell drops its resize edges.
   */
  private bindMaximizeState() {
    const button = document.getElementById('tb-maximize');
    if (!button || isMacOS()) return;
    const shell = button.closest('.ny-shell');
    let syncing = false;
    let resizedAgain = false;
    const sync = async () => {
      if (syncing) {
        resizedAgain = true;
        return;
      }
      syncing = true;
      try {
        do {
          resizedAgain = false;
          const maximized = await isWindowMaximized();
          const label = maximized ? 'shell.restore' : 'shell.maximize';
          button.classList.toggle('is-maximized', maximized);
          shell?.classList.toggle('ny-shell--maximized', maximized);
          button.setAttribute('data-i18n-title', label);
          button.setAttribute('data-i18n-aria-label', label);
          button.title = i18next.t(label);
          button.setAttribute('aria-label', i18next.t(label));
        } while (resizedAgain);
      } finally {
        syncing = false;
      }
    };
    const syncLogged = () => void sync().catch(console.error);
    syncLogged();
    void listenWindowResize(syncLogged).catch(console.error);
  }

  /**
   * Windows and Linux: the window follows the pointer once it moves a few
   * pixels with the button down, and a double-click maximizes or restores it.
   * A drag started on the press holds the pointer until the release, so the
   * page would miss the second click of a double-click.
   */
  private bindTitlebarDrag(
    titlebar: HTMLElement,
    isTitlebarClick: (event: MouseEvent) => boolean
  ) {
    let pressedAt: { x: number; y: number } | null = null;

    const release = () => {
      pressedAt = null;
      document.removeEventListener('mousemove', dragOnMove, true);
      document.removeEventListener('mouseup', release, true);
    };
    const dragOnMove = (event: MouseEvent) => {
      if (!pressedAt) return;
      if ((event.buttons & 1) === 0) {
        release();
        return;
      }
      const distance = Math.hypot(
        event.screenX - pressedAt.x,
        event.screenY - pressedAt.y
      );
      if (distance < TITLEBAR_DRAG_DISTANCE) return;
      release();
      void startWindowDrag().catch(console.error);
    };

    titlebar.addEventListener('mousedown', (event) => {
      if (!isTitlebarClick(event)) return;
      // Keeps the caret where it is and the file name unselected.
      event.preventDefault();
      release();
      if (event.detail === 2) {
        void toggleMaximizeWindow().catch(console.error);
        return;
      }
      pressedAt = { x: event.screenX, y: event.screenY };
      document.addEventListener('mousemove', dragOnMove, true);
      document.addEventListener('mouseup', release, true);
    });
  }

  private bindFileMenu() {
    if (!this.elFileMenuButton || !this.elFileMenu) return;
    const menuButton = this.elFileMenuButton;
    const menu = this.elFileMenu;

    let releaseEscape: (() => void) | null = null;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menu.contains(target) || menuButton.contains(target)) return;
      setOpen(false);
    };
    // The outside-click listener and the Escape layer exist only while the
    // menu is open.
    const setOpen = (open: boolean) => {
      if (open === !menu.hidden) return;
      menu.hidden = !open;
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        document.addEventListener('click', closeOnOutsideClick);
        releaseEscape = pushEscapeLayer({ dismiss: () => setOpen(false) });
      } else {
        document.removeEventListener('click', closeOnOutsideClick);
        releaseEscape?.();
        releaseEscape = null;
      }
    };

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(Boolean(menu.hidden));
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
    menu
      .querySelector<HTMLElement>('[data-file-action="export-pdf"]')
      ?.addEventListener('click', () => {
        setOpen(false);
        void Promise.resolve(this.actions.onExportPdf()).catch(console.error);
      });
  }

  private bindAction(id: string, handler: () => unknown) {
    document.getElementById(id)?.addEventListener('click', () => {
      Promise.resolve(handler()).catch(console.error);
    });
  }

  private bindClick(id: string, handler: () => void) {
    document.getElementById(id)?.addEventListener('click', handler);
  }

  private update(state: ReturnType<Store['getState']>) {
    const filename = documentFileName(state.filePath);
    if (this.elFilename.textContent !== filename) {
      this.elFilename.textContent = filename;
      void setWindowTitle(filename).catch(console.error);
    }
    this.elDirty.style.opacity = state.isDirty ? '1' : '0';
  }
}
