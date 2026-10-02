/**
 * `> ` typed at the start of a list item starts a quote under the item above,
 * as code typed there does; from the first item, in front of the list. A list
 * item opens with a line of text, so Milkdown's rule could not wrap the line
 * in a quote, and `> ` stayed in it as text, saved as `\>`.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { replaceLineWith } from './fence-input';

export const QUOTE = /^\s*>\s$/;

export function typedQuoteInItem(
  state: EditorState,
  _match: RegExpMatchArray,
  start: number,
  end: number
): Transaction | null {
  const { blockquote } = state.schema.nodes;
  const $start = state.doc.resolve(start);
  const line = $start.parent;
  if (!blockquote || line.type.name !== 'paragraph') return null;
  if ($start.node(-1).type.name !== 'list_item' || $start.index(-1) > 0) {
    return null;
  }
  const rest = line.copy(line.content.cut(end - $start.start()));
  const placed = replaceLineWith(state, blockquote.create(null, rest));
  if (!placed) return null;
  const { tr, at } = placed;
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

export const quoteInput = $prose(() =>
  inputRules({ rules: [new InputRule(QUOTE, typedQuoteInItem)] })
);
