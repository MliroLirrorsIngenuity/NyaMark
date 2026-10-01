/**
 * Backspace at the start of a block. Milkdown binds Backspace to "join this
 * textblock to the one before it", whatever lies in between:
 *
 * - at the start of a quote, the quoted text ran into the paragraph above;
 * - at the start of a list's first item, the list was merged into a list just
 *   above it (an ordered list turned into bullets) or moved into a quote above;
 * - after a code or math block, the paragraph ran into the code.
 *
 * Here the quote and the list let go of the block instead, the way Backspace
 * at the start of a heading turns it into a paragraph, and a paragraph after
 * code moves the caret to the end of the code. An empty paragraph after code
 * is still removed by Milkdown's join.
 */

import { liftListItem } from '@milkdown/kit/prose/schema-list';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';

/** The first item of a list that is not itself nested in a list item. */
function liftFirstItem(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth < 3) return null;
  const item = $from.node(depth - 1);
  if (item.type.name !== 'list_item') return null;
  if ($from.index(depth - 1) !== 0 || $from.index(depth - 2) !== 0) {
    return null;
  }
  // A nested list's first item already becomes a paragraph of its parent.
  if ($from.node(depth - 3).type.name === 'list_item') return null;
  let lifted: Transaction | null = null;
  liftListItem(item.type)(state, (tr) => {
    lifted = tr;
  });
  return lifted;
}

function liftOutOfQuote(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth < 2 || $from.node(depth - 1).type.name !== 'blockquote') {
    return null;
  }
  if ($from.index(depth - 1) !== 0) return null;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  return range && target != null ? state.tr.lift(range, target) : null;
}

/** Where a join would land: the end of the textblock before the caret's. */
function endOfTextblockBefore(state: EditorState) {
  const { $from } = state.selection;
  let cut = -1;
  for (let d = $from.depth - 1; d >= 0; d -= 1) {
    if ($from.index(d) > 0) {
      cut = $from.before(d + 1);
      break;
    }
    if ($from.node(d).type.spec.isolating) return null;
  }
  if (cut < 0) return null;
  let node = state.doc.resolve(cut).nodeBefore;
  let end = cut - 1;
  while (node && !node.isTextblock) {
    if (node.type.spec.isolating) return null;
    node = node.lastChild;
    end -= 1;
  }
  return node ? { node, end } : null;
}

function stopAtCode(state: EditorState): Transaction | null {
  if (state.selection.$from.parent.content.size === 0) return null;
  const before = endOfTextblockBefore(state);
  if (!before?.node.type.spec.code) return null;
  return state.tr.setSelection(TextSelection.create(state.doc, before.end));
}

export function backspaceAtBlockStart(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parentOffset !== 0) return null;
  return liftFirstItem(state) ?? liftOutOfQuote(state) ?? stopAtCode(state);
}

export const blockBackspace = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/block-backspace'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Backspace' || event.metaKey || event.altKey) {
            return false;
          }
          if (event.isComposing) return false;
          const tr = backspaceAtBlockStart(view.state);
          if (!tr) return false;
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    })
);
