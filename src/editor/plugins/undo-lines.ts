/**
 * Cmd+Z takes back a line at a time. ProseMirror keeps changes made within
 * half a second of each other as one step, and typed straight on, a
 * paragraph, the line under it and a code block after them went at a single
 * Cmd+Z. Enter now begins a step of its own, in text and in code: the line it
 * opens goes back with what was typed on it, and the lines above stay.
 *
 * A paste is a step of its own too. Cmd+Z after one took back what was typed
 * before it as well, and what was typed after it went back with the paste.
 */

import { closeHistory } from '@milkdown/kit/prose/history';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** Makes what is about to be pasted in `view` a step of its own. */
export function pasteApart(view: EditorView) {
  view.dispatch(closeHistory(view.state.tr));
  // Once the paste is in, which happens within the same event.
  queueMicrotask(() => view.dispatch(closeHistory(view.state.tr)));
}

export const undoByLine = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/undo-by-line'),
      props: {
        handleDOMEvents: {
          paste(view) {
            pasteApart(view);
            return false;
          },
        },
      },
      view(view) {
        // On the way down, ahead of the text's keys and a code block's.
        const begin = (event: KeyboardEvent) => {
          if (event.key !== 'Enter' || event.isComposing) return;
          if (event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
          if (event.altKey) return;
          view.dispatch(closeHistory(view.state.tr));
        };
        view.dom.addEventListener('keydown', begin, true);
        return {
          destroy: () => view.dom.removeEventListener('keydown', begin, true),
        };
      },
    })
);
