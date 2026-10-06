/**
 * A formula in a line is edited from the keyboard as from the mouse. An arrow
 * key selects it on the way past and Crepe shows its source in a box under
 * it, which only a click got into: Enter split the line in front of the
 * formula instead. Enter now puts the caret at the end of the source, Enter
 * there saves it as before, and Escape leaves it unchanged, with the caret
 * after the formula.
 *
 * A click on the formula selected it and showed the box with the caret still
 * in the line, and so did a key typed while it was selected: what was typed
 * next took the formula's place, and the box with it. Both now go on into the
 * source. Saved, the formula stayed selected, and the next word typed after
 * it replaced it; the caret now goes on past it, where the line continues.
 */

import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/kit/prose/state';
import { AttrStep } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const BOX = '.milkdown-latex-inline-edit';

function sourceEditor(view: EditorView) {
  return view.dom.parentElement?.querySelector<HTMLElement>(
    `${BOX}[data-show="true"] .ProseMirror`
  );
}

const formulaSelected = (state: EditorState) =>
  state.selection instanceof NodeSelection &&
  state.selection.node.type.name === 'math_inline';

/** The caret at the end of the formula's source, in the box under it. */
function editSource(view: EditorView): boolean {
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
}

/** A key that types: a character, or one an input method takes up. */
const types = (event: KeyboardEvent) =>
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  (event.key.length === 1 || event.key === 'Process' || event.keyCode === 229);

export const mathInlineKeys = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/math-inline-keys'),
      props: {
        handleKeyDown(view, event) {
          if (!formulaSelected(view.state)) return false;
          if (event.key === 'Enter' && !event.isComposing) {
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            return editSource(view);
          }
          // Focus moves before the key is taken: what it types goes there.
          if (types(event)) editSource(view);
          return false;
        },
        handleClickOn(view, _pos, node, _nodePos, _event, direct) {
          if (!direct || node.type.name !== 'math_inline') return false;
          // The box is drawn once the selection the click makes is.
          let frames = 3;
          const open = () => {
            if (!formulaSelected(view.state)) return;
            if (!editSource(view) && --frames > 0) {
              requestAnimationFrame(open);
            }
          };
          requestAnimationFrame(open);
          return false;
        },
      },
      appendTransaction(trs, _old, state) {
        if (!formulaSelected(state)) return null;
        const saved = trs.some((tr) =>
          tr.steps.some((step) => step instanceof AttrStep)
        );
        if (!saved) return null;
        return state.tr.setSelection(
          TextSelection.create(state.doc, state.selection.to)
        );
      },
      view(view) {
        const root = view.dom.parentElement;
        const leave = (event: KeyboardEvent) => {
          if (event.key !== 'Escape' || event.isComposing) return;
          if (!(event.target as Element).closest?.(BOX)) return;
          event.preventDefault();
          event.stopPropagation();
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
