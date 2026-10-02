/**
 * Images pasted, dropped or picked go in as blocks of their own, at the
 * caret. Put in with replaceSelection, the last one was left selected: no
 * caret, and the letters typed next went nowhere. On an empty line of a list,
 * whose items open with a line of text, the line stayed above the image as an
 * empty bullet and the caret went on to the line under the list.
 *
 * The caret goes to a line under the images now, an empty one already there
 * or a new one, ready for the text that follows. An empty line gives its
 * place to them, in a list item going under the item above as a code block
 * typed there does. Pasted in the middle of a line, they split it and the
 * caret is left in front of its rest; at the start of one, they go above it.
 */

import { Fragment, type Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  NodeSelection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { replaceLineWith } from './fence-input';

/** The caret on an empty line at `pos`, the one there or a new one. */
export function caretOnLineAt(tr: Transaction, pos: number): Transaction {
  const { paragraph } = tr.doc.type.schema.nodes;
  if (!paragraph) return tr;
  const next = tr.doc.nodeAt(pos);
  if (next?.type !== paragraph || next.content.size > 0) {
    tr.insert(pos, paragraph.create());
  }
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1));
}

/** `blocks` put in at the caret, the caret on the line after them. */
export function insertBlocks(
  state: EditorState,
  blocks: Node[]
): Transaction | null {
  const { selection } = state;
  const $pos = selection instanceof TextSelection ? selection.$cursor : null;
  if (!$pos || $pos.parent.type.spec.code) return null;
  const line = $pos.parent;
  const content = Fragment.fromArray(blocks);

  if (line.type.name === 'paragraph' && line.content.size === 0) {
    const placed = replaceLineWith(state, content);
    return placed && caretOnLineAt(placed.tr, placed.at + content.size);
  }

  const parent = $pos.node(-1);
  const index = $pos.index(-1);
  if ($pos.parentOffset === 0) {
    if (!parent.canReplace(index, index, content)) return null;
    const at = $pos.before();
    const tr = state.tr.insert(at, content);
    return tr.setSelection(TextSelection.create(tr.doc, at + content.size + 1));
  }
  if (!parent.canReplace(index + 1, index + 1, content)) return null;
  if ($pos.parentOffset === line.content.size) {
    const at = $pos.after();
    return caretOnLineAt(state.tr.insert(at, content), at + content.size);
  }
  // Between the two halves of the line.
  const at = $pos.pos + 1;
  const tr = state.tr.split($pos.pos).insert(at, content);
  return tr.setSelection(TextSelection.create(tr.doc, at + content.size + 1));
}

/** A block left selected by an insert gives the caret to the line after it. */
export function caretPastSelectedBlock(tr: Transaction): Transaction {
  const { selection } = tr;
  if (!(selection instanceof NodeSelection) || !selection.node.isBlock) {
    return tr;
  }
  return caretOnLineAt(tr, selection.to);
}
