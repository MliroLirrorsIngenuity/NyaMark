/**
 * Enter in an empty item of a list inside another item steps it out one
 * level, as Shift+Tab does. It did so for the last item of the list alone:
 * further up, the line was taken out of the list and left without a bullet
 * between the two halves of the list it cut, saved as `<br />`, and a
 * numbered list after it started again from 1.
 */

import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { NodeType } from '@milkdown/kit/prose/model';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** The caret on the empty last line of an item in a list inside an item. */
function inEmptyNestedItem(state: EditorState, item: NodeType): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
  const $cursor = selection.$cursor;
  if ($cursor.parent.content.size > 0 || $cursor.depth < 4) return false;
  if ($cursor.node(-1).type !== item || $cursor.node(-3).type !== item) {
    return false;
  }
  return $cursor.indexAfter(-1) === $cursor.node(-1).childCount;
}

export const listEnter = $prose((ctx) => {
  const item = listItemSchema.type(ctx);
  return new Plugin({
    key: new PluginKey('nyamark/list-enter'),
    props: {
      // Ahead of the list's own Enter, which bails out in the middle of a list.
      handleDOMEvents: {
        keydown(view, event) {
          if (event.key !== 'Enter' || event.isComposing || view.composing) {
            return false;
          }
          if (event.shiftKey || event.altKey || event.metaKey) return false;
          if (event.ctrlKey) return false;
          if (!inEmptyNestedItem(view.state, item)) return false;
          if (!liftListItem(item)(view.state, view.dispatch)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
});
