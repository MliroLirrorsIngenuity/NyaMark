/**
 * Tab in an item that cannot go a level further in leaves it where it is. The
 * first item of a list has no item above it to go under, and the key went on
 * to the indent that types two spaces: they stood in front of the text of the
 * item, and a line taken out of the list afterwards was saved as `&#x20;`.
 */

import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { NodeType } from '@milkdown/kit/prose/model';
import { sinkListItem } from '@milkdown/kit/prose/schema-list';
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** The selection is in items of a list, none of which can go further in. */
export function itemsStayPut(state: EditorState, item: NodeType): boolean {
  const { $from, $to } = state.selection;
  // A table or code in an item keeps its own Tab.
  if ($from.depth < 2 || $from.node(-1).type !== item) return false;
  const range = $from.blockRange(
    $to,
    (node) => node.childCount > 0 && node.firstChild?.type === item
  );
  return !!range && !sinkListItem(item)(state);
}

export const listTab = $prose((ctx) => {
  const item = listItemSchema.type(ctx);
  return new Plugin({
    key: new PluginKey('nyamark/list-tab'),
    props: {
      // Ahead of the keymaps, where the indent comes after the list's own Tab.
      handleDOMEvents: {
        keydown(view, event) {
          if (event.key !== 'Tab' || event.isComposing || view.composing) {
            return false;
          }
          if (event.shiftKey || event.altKey || event.metaKey) return false;
          if (event.ctrlKey) return false;
          if (!itemsStayPut(view.state, item)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
});
