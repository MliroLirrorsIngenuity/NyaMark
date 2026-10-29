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
import { isMacOS, isMobilePlatform } from '../platform/detect';
import { documentFileName } from './document-name';
import { pushEscapeLayer } from './escape-layers';
import { type ModalHandle, openModal } from './modal';
import { requireElement } from './require-element';
import { COMPACT_QUERY, isCompactLayout } from './viewport';

type TitlebarActions = {
  onNewFile: () => unknown;
  onOpenFile: () => unknown;
  onSaveFile: () => unknown;
  onSaveFileAs: () => unknown;
  onExportPdf: () => unknown;
  /** Phone only: the document library, renaming and sharing the document, printing. */
  onShowLibrary?: () => unknown;
  onRename?: () => unknown;
  onShare?: (anchor: DOMRect | null) => unknown;
  onPrint?: () => unknown;
  onToggleOutline: () => unknown;
  onToggleAi: () => unknown;
  onOpenSettings: () => void;
  onFind: () => void;
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
    if (!isMobilePlatform()) {
      this.bindWindowChromeRestore();
      this.bindMaximizeState();
    }
    this.bindFileMenu();
    this.bindAction('tb-outline', this.actions.onToggleOutline);
    this.bindAction('tb-ai', this.actions.onToggleAi);
    this.bindClick('tb-settings', () => this.actions.onOpenSettings());
    if (this.actions.onShowLibrary) {
      this.bindAction('mb-library', this.actions.onShowLibrary);
    }
    this.bindAction('mb-outline', this.actions.onToggleOutline);
    this.bindAction('mb-ai', this.actions.onToggleAi);
    this.bindClick('mb-settings', () => this.actions.onOpenSettings());
    this.bindClick('mb-find', () => this.actions.onFind());
    this.bindClick('mb-source', () => {
      this.store.update({ sourceMode: !this.store.getState().sourceMode });
    });
    this.bindClick('mb-keyboard', () => {
      document
        .getElementById('tb-file-menu-button')
        ?.focus({ preventScroll: true });
    });
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
      !isCompactLayout() && event.button === 0 && event.target === titlebar;

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
    let modal: ModalHandle | null = null;
    let backdrop: HTMLElement | null = null;
    const home = requireElement(document, '.ny-shell__file-menu');
    const app = requireElement(document, '#ny-app');
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
      if (open && isCompactLayout()) {
        backdrop = document.createElement('div');
        backdrop.className = 'ny-file-backdrop';
        document.body.append(backdrop, menu);
        modal = openModal({
          overlay: backdrop,
          dialog: menu,
          initialFocus: menu,
          restoreFocus: false,
          onDismiss: () => setOpen(false),
        });
        app.inert = true;
      } else if (open) {
        document.addEventListener('click', closeOnOutsideClick);
        releaseEscape = pushEscapeLayer({ dismiss: () => setOpen(false) });
      } else {
        document.removeEventListener('click', closeOnOutsideClick);
        releaseEscape?.();
        releaseEscape = null;
        if (!modal) return;
        modal.release();
        modal = null;
        backdrop?.remove();
        backdrop = null;
        menu.removeAttribute('aria-modal');
        menu.setAttribute('role', 'menu');
        home.append(menu);
        app.inert = false;
        menuButton.focus({ preventScroll: true });
      }
    };

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(Boolean(menu.hidden));
    });

    const fileActions: Record<string, () => unknown> = {
      new: this.actions.onNewFile,
      open: this.actions.onOpenFile,
      save: this.actions.onSaveFile,
      'save-as': this.actions.onSaveFileAs,
      'export-pdf': this.actions.onExportPdf,
      rename: () => this.actions.onRename?.(),
      share: () =>
        this.actions.onShare?.(
          this.elFileMenuButton?.getBoundingClientRect() ?? null
        ),
      print: () => this.actions.onPrint?.(),
    };
    menu.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>(
        '[data-file-action], [data-file-dismiss]'
      );
      if (!button) return;
      setOpen(false);
      const action = button.dataset.fileAction;
      if (action)
        void Promise.resolve(fileActions[action]?.()).catch(console.error);
    });
    window
      .matchMedia(COMPACT_QUERY)
      .addEventListener('change', () => setOpen(false));
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
    const status = document.getElementById('tb-mobile-status');
    if (status) {
      status.textContent = `${i18next.t(state.isDirty || !state.filePath ? 'mobile.unsaved' : 'mobile.saved')} · ${i18next.t('statusbar.words', { count: state.wordCount })}`;
    }
    document
      .getElementById('mb-source')
      ?.setAttribute('aria-pressed', String(state.sourceMode));
  }
}
