/**
 * Cmd+Z takes back a line at a time. ProseMirror keeps changes made within
 * half a second of each other as one step, and typed straight on, a
 * paragraph, the line under it and a code block after them went at a single
 * Cmd+Z. Enter now begins a step of its own, in text and in code: the line it
 * opens goes back with what was typed on it, and the lines above stay.
 */

import { closeHistory } from '@milkdown/kit/prose/history';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const undoByLine = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/undo-by-line'),
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
