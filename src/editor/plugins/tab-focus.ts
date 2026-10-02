/**
 * Keeps Tab and Shift+Tab inside the editor.
 *
 * Tab always does something here (Crepe indents whatever no other key
 * binding takes), but Shift+Tab only means something in a list or a table
 * cell after the first. Anywhere else -- a paragraph, a quote, the first cell
 * of a table -- the browser moved focus out of the editor and the caret was
 * gone. A Tab that no handler took is now dropped.
 *
 * The listener sits on the editor element after ProseMirror's own, so a key a
 * binding handled is already marked by the time it runs. Only keys typed into
 * the text itself are held: an input inside a block keeps its own Tab order.
 *
 * Tab at the start of a line of text, past nothing but spaces, leaves it as
 * it is. The four spaces of the indent could not be kept in the Markdown:
 * they were saved as `&#x20;   ` in front of a paragraph, and in front of a
 * heading or a line after a line break they were gone when the file was
 * opened again. In a list or a table Tab has its own work, and further along
 * a line it still puts the spaces in.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const OWN_TAB = new Set(['list_item', 'table_cell', 'table_header']);

/** The indent at the selection would stand at the start of a line. */
export function indentAtLineStart(state: EditorState): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $to } = selection;
  if (!$to.parent.isTextblock || $to.parent.type.spec.code) return false;
  for (let depth = $to.depth - 1; depth > 0; depth -= 1) {
    if (OWN_TAB.has($to.node(depth).type.name)) return false;
  }
  const before = $to.parent.textBetween(0, $to.parentOffset, '\n', (leaf) =>
    leaf.type.name === 'hardbreak' ? '\n' : '\ufffc'
  );
  return /^[ \t]*$/.test(before.slice(before.lastIndexOf('\n') + 1));
}

export const tabFocus = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/tab-focus'),
      props: {
        // Ahead of the keymaps, where the indent is.
        handleDOMEvents: {
          keydown(view, event) {
            if (event.key !== 'Tab' || event.isComposing || view.composing) {
              return false;
            }
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            if (!indentAtLineStart(view.state)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
      view(view) {
        const hold = (event: KeyboardEvent) => {
          if (event.key !== 'Tab' || event.defaultPrevented) return;
          if (event.target !== view.dom) return;
          event.preventDefault();
        };
        view.dom.addEventListener('keydown', hold);
        return {
          destroy: () => view.dom.removeEventListener('keydown', hold),
        };
      },
    })
);
