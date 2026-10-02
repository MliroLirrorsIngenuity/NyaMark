/**
 * A link put on the selected text from the link box leaves the caret just
 * after it, outside the link, as a click past its end does. The text stayed
 * selected once the box closed, and the first key typed took its place, the
 * link going with it.
 */

import {
  type EditorState,
  Plugin,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { AddMarkStep } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';
import { marksAround } from './mark-cursor';

/** The caret after the link `trs` put on all of the selection, if they did. */
export function caretAfterLink(
  trs: readonly Transaction[],
  state: EditorState
): Transaction | null {
  const { selection } = state;
  const link = state.schema.marks.link;
  if (!link || !(selection instanceof TextSelection)) return null;
  if (selection.empty) return null;
  const linked = trs.some((tr) =>
    tr.steps.some(
      (step) =>
        step instanceof AddMarkStep &&
        step.mark.type === link &&
        step.from === selection.from &&
        step.to === selection.to
    )
  );
  if (!linked) return null;
  const at = TextSelection.create(state.doc, selection.to);
  return state.tr.setSelection(at).setStoredMarks(marksAround(at.$head)[1]);
}

export const caretAfterLinkEdit = $prose(
  () =>
    new Plugin({
      appendTransaction: (trs, _old, state) => caretAfterLink(trs, state),
    })
);
