import { isMacOS } from '../platform/detect';

type ShortcutHandlers = {
  newFile: () => unknown;
  openFile: () => unknown;
  saveFile: () => unknown;
  saveFileAs: () => unknown;
  print: () => void;
  find: () => void;
  toggleOutline: () => void;
  openSettings: () => void;
};

/**
 * The platform's primary shortcut modifier: Command on macOS, Control
 * elsewhere. On a Mac, Control is an ordinary key that emacs-style bindings
 * such as Ctrl+P (previous line) and Ctrl+F (forward one character) use, so
 * it must never stand in for Command.
 */
export function hasPrimaryModifier(event: KeyboardEvent | MouseEvent) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}

/**
 * Every application-level keyboard shortcut lives here. On macOS the native
 * menu owns the accelerators it lists (New, Open, Save, Save As, Export PDF,
 * Settings, Quit); binding them here as well would fire each action twice
 * per keypress. What the menu does not cover is bound on every platform.
 */
export class ShortcutController {
  private readonly menuOwnsFileShortcuts = isMacOS();

  constructor(private readonly handlers: ShortcutHandlers) {}

  bind() {
    window.addEventListener('keydown', (event) => this.dispatch(event));
  }

  private dispatch(event: KeyboardEvent) {
    if (!hasPrimaryModifier(event) || event.altKey) return;
    if (event.repeat || event.isComposing) return;

    // CodeMirror (the source pane and code blocks) has its own search panel
    // on Mod-F; opening the document search on top of it helps nobody.
    if (event.code === 'KeyF' && !event.shiftKey) {
      if (this.targetsCodeMirror(event)) return;
      event.preventDefault();
      this.handlers.find();
      return;
    }

    if (event.code === 'KeyO' && event.shiftKey) {
      event.preventDefault();
      this.handlers.toggleOutline();
      return;
    }

    if (this.menuOwnsFileShortcuts) return;

    if (event.shiftKey) {
      if (event.code === 'KeyS') {
        event.preventDefault();
        void this.handlers.saveFileAs();
      }
      return;
    }

    switch (event.code) {
      case 'KeyS':
        event.preventDefault();
        void this.handlers.saveFile();
        break;
      case 'KeyO':
        event.preventDefault();
        void this.handlers.openFile();
        break;
      case 'KeyN':
        event.preventDefault();
        void this.handlers.newFile();
        break;
      case 'KeyP':
        event.preventDefault();
        this.handlers.print();
        break;
      case 'Comma':
        event.preventDefault();
        this.handlers.openSettings();
        break;
      default:
        break;
    }
  }

  private targetsCodeMirror(event: KeyboardEvent) {
    const target = event.target;
    return target instanceof Element && target.closest('.cm-editor') !== null;
  }
}
