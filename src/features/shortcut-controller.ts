import { isMacOS } from '../platform/detect';
import { isModalOpen } from '../ui/modal';

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
 * The key a shortcut was pressed with, named as `event.code` names keys:
 * the letter the layout puts on it, so Mod-F is the F of AZERTY or Dvorak
 * as in the menus, and the key's QWERTY place under a layout of another
 * script, as ProseMirror and CodeMirror read their keys.
 */
export function shortcutKey(event: KeyboardEvent) {
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (event.key === ',') return 'Comma';
  return event.code;
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
    // Captured: a code block's CodeMirror binds Mod-F itself and would act
    // before the event bubbled up here.
    window.addEventListener('keydown', (event) => this.find(event), true);
    window.addEventListener('keydown', (event) => this.dispatch(event));
  }

  /**
   * Mod-F searches the document, from a code block too: CodeMirror's own
   * panel opened inside the block, English and unstyled, and searched only
   * that block. The source pane keeps it; it searches the markdown on show.
   */
  private find(event: KeyboardEvent) {
    if (!hasPrimaryModifier(event) || event.altKey || event.shiftKey) return;
    if (shortcutKey(event) !== 'KeyF' || event.isComposing) return;
    // A dialog holds the keys: the bar opened behind it took the focus,
    // and what was typed next went there.
    if (this.targetsSourcePane(event) || isModalOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) this.handlers.find();
  }

  private dispatch(event: KeyboardEvent) {
    if (!hasPrimaryModifier(event) || event.altKey) return;
    if (event.repeat || event.isComposing) return;
    if (isModalOpen()) return;

    const key = shortcutKey(event);
    if (key === 'KeyO' && event.shiftKey) {
      event.preventDefault();
      this.handlers.toggleOutline();
      return;
    }

    if (this.menuOwnsFileShortcuts) return;

    if (event.shiftKey) {
      if (key === 'KeyS') {
        event.preventDefault();
        void this.handlers.saveFileAs();
      }
      return;
    }

    switch (key) {
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

  private targetsSourcePane(event: KeyboardEvent) {
    const target = event.target;
    return (
      target instanceof Element &&
      target.closest('.ny-source-pane .cm-editor') !== null
    );
  }
}
