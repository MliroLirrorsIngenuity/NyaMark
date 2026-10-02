/**
 * Once a word of an input method is in, the editor's menus look at the text
 * again. They pass over the changes made while a word is being put together,
 * and the word itself goes in before the input method is done: `/标题` typed
 * with the Chinese input method left the slash menu showing all of its items,
 * and Enter turned the line into plain text where a heading was asked for.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** Past ProseMirror's own end of the composition, 20ms after the event. */
const SETTLE_MS = 40;

export const compositionSettle = $prose(() => {
  // A change came while a word was being put together.
  let unseen = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Plugin({
    key: new PluginKey('nyamark/composition-settle'),
    view() {
      return {
        update(view) {
          if (view.composing) unseen = true;
        },
        destroy() {
          clearTimeout(timer);
        },
      };
    },
    props: {
      handleDOMEvents: {
        compositionend(view) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!unseen || view.isDestroyed || view.composing) return;
            unseen = false;
            view.dispatch(view.state.tr);
          }, SETTLE_MS);
          return false;
        },
      },
    },
  });
});
