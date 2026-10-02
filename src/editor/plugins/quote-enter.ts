/**
 * Enter on an empty line of a quote takes the line out of it, wherever the
 * line stands. On the last line it did; further up the quote was cut in two
 * under the line, the caret left in the lower half on a line of it, and only
 * a third Enter took the line out.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';

/** The empty line the caret is on, lifted out of the quote around it. */
export function liftEmptyQuoteLine(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return null;
  const $cursor = selection.$cursor;
  if (!$cursor.parent.isTextblock || $cursor.parent.content.size > 0) {
    return null;
  }
  if ($cursor.depth < 2 || $cursor.node(-1).type.name !== 'blockquote') {
    return null;
  }
  // The last line leaves as it did.
  if ($cursor.index(-1) === $cursor.node(-1).childCount - 1) return null;
  const range = $cursor.blockRange();
  const target = range && liftTarget(range);
  return range && target != null ? state.tr.lift(range, target) : null;
}

export const quoteEnter = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/quote-enter'),
      props: {
        // Ahead of the Enter of the base keymap, which cuts the quote first.
        handleDOMEvents: {
          keydown(view, event) {
            if (event.key !== 'Enter' || event.isComposing || view.composing) {
              return false;
            }
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            const tr = liftEmptyQuoteLine(view.state);
            if (!tr) return false;
            view.dispatch(tr.scrollIntoView());
            event.preventDefault();
            return true;
          },
        },
      },
    })
);
