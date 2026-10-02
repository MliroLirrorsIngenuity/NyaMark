/**
 * Enter in an empty item of a list inside another item steps it out one
 * level, as Shift+Tab does. It did so for the last item of the list alone:
 * further up, the line was taken out of the list and left without a bullet
 * between the two halves of the list it cut, saved as `<br />`, and a
 * numbered list after it started again from 1.
 *
 * Enter in a task ticked off leaves the new task open. Both halves of the
 * item cut took its box, and a task added under one done was done already.
 */

import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { NodeType } from '@milkdown/kit/prose/model';
import { liftListItem, splitListItem } from '@milkdown/kit/prose/schema-list';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
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

/** The task ticked off around the caret cut in two, the new half left open. */
export function splitDoneTask(
  state: EditorState,
  item: NodeType
): Transaction | null {
  const { $from } = state.selection;
  if ($from.depth < 2) return null;
  const task = $from.node(-1);
  if (task.type !== item || task.attrs.checked !== true) return null;
  let split: Transaction | null = null;
  splitListItem(item)(state, (tr) => {
    split = tr;
  });
  if (!split) return null;
  const tr: Transaction = split;
  // The caret goes down into the new task, or, from the very start of the
  // item, the new task is the empty one left above it.
  const $caret = tr.selection.$from;
  let at = $caret.before(-1);
  if ($from.parentOffset === 0 && $from.index(-1) === 0) {
    at -= tr.doc.resolve(at).nodeBefore?.nodeSize ?? 0;
  }
  const added = tr.doc.nodeAt(at);
  if (added?.type !== item) return null;
  return tr.setNodeMarkup(at, undefined, { ...added.attrs, checked: false });
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
          if (inEmptyNestedItem(view.state, item)) {
            if (!liftListItem(item)(view.state, view.dispatch)) return false;
          } else {
            const tr = splitDoneTask(view.state, item);
            if (!tr) return false;
            view.dispatch(tr.scrollIntoView());
          }
          event.preventDefault();
          return true;
        },
      },
    },
  });
});
