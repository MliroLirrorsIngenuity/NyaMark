/**
 * A formula in a line is edited from the keyboard as from the mouse. An arrow
 * key selects it on the way past and Crepe shows its source in a box under
 * it, which only a click got into: Enter split the line in front of the
 * formula instead. Enter now puts the caret at the end of the source, Enter
 * there saves it as before, and Escape leaves it unchanged, with the caret
 * after the formula.
 */

import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const BOX = '.milkdown-latex-inline-edit';

function sourceEditor(view: EditorView) {
  return view.dom.parentElement?.querySelector<HTMLElement>(
    `${BOX}[data-show="true"] .ProseMirror`
  );
}

export const mathInlineKeys = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/math-inline-keys'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || event.isComposing) return false;
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
            return false;
          const { selection } = view.state;
          if (
            !(selection instanceof NodeSelection) ||
            selection.node.type.name !== 'math_inline'
          )
            return false;
          const editor = sourceEditor(view);
          if (!editor) return false;
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const caret = getSelection();
          caret?.removeAllRanges();
          caret?.addRange(range);
          return true;
        },
      },
      view(view) {
        const root = view.dom.parentElement;
        const leave = (event: KeyboardEvent) => {
          if (event.key !== 'Escape' || event.isComposing) return;
          if (!(event.target as Element).closest?.(BOX)) return;
          event.preventDefault();
          const { state } = view;
          const after = TextSelection.create(state.doc, state.selection.to);
          view.dispatch(state.tr.setSelection(after));
          view.focus();
        };
        root?.addEventListener('keydown', leave);
        return { destroy: () => root?.removeEventListener('keydown', leave) };
      },
    })
);
