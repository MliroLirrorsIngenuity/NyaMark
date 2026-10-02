/**
 * The caret stays where it is in a code block drawn anew, as one quoted is.
 * The block takes its colours a moment after it is drawn, once its language
 * has loaded, and colouring rewrites the text of the line the caret is on.
 * WebKit puts a caret in rewritten text at its start, and CodeMirror, which
 * had just put the caret in and took it to be there still, read the move as
 * the user's: the caret stood at the start of the block, and what was typed
 * next went in there.
 *
 * After the block is coloured the caret goes back to where CodeMirror has it.
 */

import { EditorView as CodeMirror } from '@codemirror/view';

export const caretThroughColour = CodeMirror.updateListener.of((update) => {
  if (!update.transactions.some((tr) => tr.reconfigured)) return;
  const { view } = update;
  if (!view.hasFocus || view.composing) return;
  const dom = view.contentDOM.ownerDocument.getSelection();
  if (!dom?.anchorNode || !dom.focusNode) return;
  if (!view.contentDOM.contains(dom.focusNode)) return;
  const { anchor, head } = view.state.selection.main;
  if (
    view.posAtDOM(dom.anchorNode, dom.anchorOffset) === anchor &&
    view.posAtDOM(dom.focusNode, dom.focusOffset) === head
  ) {
    return;
  }
  const from = view.domAtPos(anchor);
  const to = view.domAtPos(head);
  dom.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
});
