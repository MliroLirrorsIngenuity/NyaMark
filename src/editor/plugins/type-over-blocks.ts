/**
 * Text typed over a selection running across blocks goes where Backspace
 * would leave the caret, as text from the input method already does: the
 * blocks the selection covers whole go, and the line it ends in stays what
 * it was.
 *
 * A letter from a key went into the first block instead, and a list item the
 * selection ended in stayed behind as an empty bullet. Text that came with no
 * key, from dictation or the emoji picker, went through the page's own
 * editing, which took a nested list out of its item.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** `text` in place of a selection across blocks, or null for any other. */
export function typeOver(state: EditorState, text: string): Transaction | null {
  const { selection } = state;
  if (selection.empty || selection.$from.sameParent(selection.$to)) {
    return null;
  }
  const tr = state.tr.deleteSelection();
  if (!tr.selection.$from.parent.inlineContent) return null;
  return tr.insertText(text).scrollIntoView();
}

export const typeOverBlocks = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/type-over-blocks'),
      props: {
        handleTextInput(view, from, to, text) {
          const { selection } = view.state;
          if (view.composing || from !== selection.from) return false;
          if (to !== selection.to) return false;
          const tr = typeOver(view.state, text);
          if (!tr) return false;
          view.dispatch(tr);
          return true;
        },
        handleDOMEvents: {
          beforeinput(view, event) {
            if (event.inputType !== 'insertText' || !event.data) return false;
            if (event.isComposing || view.composing) return false;
            const tr = typeOver(view.state, event.data);
            if (!tr) return false;
            event.preventDefault();
            view.dispatch(tr);
            return true;
          },
        },
      },
    })
);
