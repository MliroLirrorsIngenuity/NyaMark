/**
 * Enter on an empty item at the end of a list in the source pane leaves the
 * list with a blank line after it. CodeMirror took only the marker away, and
 * the line typed under the last item was read as more of it: the paragraph
 * went into the list, joined to the item's text.
 */

import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import type { StateCommand, Transaction } from '@codemirror/state';

/** A line of a list marker alone, a task box after it or not, unindented. */
const EMPTY_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?: \[[ xX]\])?[ \t]*$/;

export const continueMarkup: StateCommand = ({ state, dispatch }) => {
  let continued = null as Transaction | null;
  const run = insertNewlineContinueMarkup({
    state,
    dispatch: (tr) => {
      continued = tr;
    },
  });
  if (!run || !continued) return run;
  const tr: Transaction = continued;
  const line = state.doc.lineAt(state.selection.main.head);
  const at = tr.state.selection.main.head;
  const now = tr.state.doc.lineAt(at);
  const left =
    state.selection.ranges.length === 1 &&
    EMPTY_ITEM.test(line.text) &&
    now.number === line.number &&
    now.length === 0 &&
    now.number > 1 &&
    /\S/.test(tr.state.doc.line(now.number - 1).text);
  if (!left) {
    dispatch(tr);
    return true;
  }
  const blank = tr.state.update({
    changes: { from: at, insert: tr.state.lineBreak },
    selection: { anchor: at + tr.state.lineBreak.length },
  });
  dispatch(
    state.update({
      changes: tr.changes.compose(blank.changes),
      selection: blank.selection,
      scrollIntoView: true,
      userEvent: 'input',
    })
  );
  return true;
};
