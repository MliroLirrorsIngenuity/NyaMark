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
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const tabFocus = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/tab-focus'),
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
