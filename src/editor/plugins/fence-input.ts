/**
 * "```" typed on a line of its own, with a language after it or none, starts
 * a code block on Enter -- inside a list item too. There the list's own Enter
 * came first and split the item, and the backticks stayed behind as text in a
 * bullet of their own. A list item opens with a line of text, so the block
 * goes under the item above, as code indented to it would; from the first
 * item, in front of the list.
 *
 * Milkdown's rule for it took only a lowercase name, so "```C++" stayed text;
 * any name without a space goes. `$$` starts a formula the same way: in a list
 * item it stayed as text too.
 *
 * A space after the fence starts the block too, as Milkdown's rule has it.
 * That rule never reached a list item, whose first line has to be text, so
 * "```py " there stayed text and the code typed after it ran on in the line.
 */

import type { Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const FENCE = /^```([^\s`]*)$/;

/**
 * The caret's line replaced with `block`, and where the block went. A list
 * item opens with a line of text, so from one the block goes under the item
 * above; from the first item, in front of the list. A table typed as its top
 * row goes there the same way.
 */
export function replaceLineWith(
  state: EditorState,
  block: Node
): { tr: Transaction; at: number } | null {
  const { $head } = state.selection;
  const item = $head.node(-1);
  if (item.type.name === 'list_item' && $head.index(-1) === 0) {
    if (item.childCount !== 1) return null;
    const itemFrom = $head.before(-1);
    const itemTo = $head.after(-1);
    if ($head.index(-2) > 0) {
      // The end of the item above, inside it.
      const at = itemFrom - 1;
      return { tr: state.tr.delete(itemFrom, itemTo).insert(at, block), at };
    }
    const $list = state.doc.resolve($head.before(-2));
    const index = $list.index();
    if (!$list.parent.canReplaceWith(index, index, block.type)) return null;
    const at = $list.pos;
    const tr =
      $head.node(-2).childCount === 1
        ? state.tr.replaceWith(at, $head.after(-2), block)
        : state.tr.delete(itemFrom, itemTo).insert(at, block);
    return { tr, at };
  }

  const index = $head.index(-1);
  if (!$head.node(-1).canReplaceWith(index, index + 1, block.type)) return null;
  const at = $head.before();
  return { tr: state.tr.replaceWith(at, $head.after(), block), at };
}

export function fenceFromLine(state: EditorState): Transaction | null {
  const code = state.schema.nodes.code_block;
  const { selection } = state;
  if (!code || !(selection instanceof TextSelection)) return null;
  const $head = selection.$cursor;
  const line = $head?.parent;
  if (!$head || line?.type.name !== 'paragraph') return null;
  if ($head.parentOffset !== line.content.size) return null;
  const text = (line.childCount === 1 && line.firstChild?.text) || '';
  const language = text === '$$' ? 'LaTeX' : FENCE.exec(text)?.[1];
  if (language == null) return null;
  const placed = replaceLineWith(state, code.create({ language }));
  if (!placed) return null;
  const { tr, at } = placed;
  return tr.setSelection(TextSelection.create(tr.doc, at + 1));
}

export const fenceInput = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/fence-input'),
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== ' ' || from !== to || view.composing) return false;
          if (view.state.selection.head !== from) return false;
          const tr = fenceFromLine(view.state);
          if (!tr) return false;
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        // Ahead of every plugin's handleKeyDown, the list's Enter among them.
        handleDOMEvents: {
          keydown(view, event) {
            if (event.key !== 'Enter' || event.isComposing || view.composing) {
              return false;
            }
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            const tr = fenceFromLine(view.state);
            if (!tr) return false;
            view.dispatch(tr.scrollIntoView());
            event.preventDefault();
            return true;
          },
        },
      },
    })
);
