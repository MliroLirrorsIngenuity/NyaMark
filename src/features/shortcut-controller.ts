import { isMacOS } from '../platform/detect';

type ShortcutHandlers = {
  newFile: () => Promise<unknown> | void;
  openFile: () => Promise<unknown> | void;
  saveFile: () => Promise<unknown> | void;
  saveFileAs: () => Promise<unknown> | void;
  print: () => void;
};

export class ShortcutController {
  private readonly isMac = isMacOS();

  constructor(private readonly handlers: ShortcutHandlers) {}

  bind() {
    window.addEventListener('keydown', (event) => this.dispatch(event));
  }

  // macOS keyboard shortcuts come from the native app menu. Only bind the
  // platform-specific bits that the menu cannot cover (e.g. Save As, Print).
  private dispatch(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;

    if (event.shiftKey && event.code === 'KeyS') {
      event.preventDefault();
      void this.handlers.saveFileAs();
      return;
    }

    if (!event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      this.handlers.print();
      return;
    }

    if (this.isMac) return;

    if (event.shiftKey) return;

    if (event.code === 'KeyS') {
      event.preventDefault();
      void this.handlers.saveFile();
    } else if (event.code === 'KeyO') {
      event.preventDefault();
      void this.handlers.openFile();
    } else if (event.code === 'KeyN') {
      event.preventDefault();
      void this.handlers.newFile();
    }
  }
}
