/**
 * A code block at the start or the end of a paste stays a block. Pasted into
 * a line of text, the code ran into the line: the rest of the line went on
 * at the end of the last code block, and the first code block's lines came
 * in as text, its line breaks with them. A snippet copied from a web page,
 * its code last, pasted in front of a line made the line code.
 *
 * Code of one line alone, as a word picked out of a block on a page, still
 * goes into the line as text. Pasted over all of a line, an empty one most
 * often, or at the end of one, the code goes in as it did, the caret at its
 * end, there being no text for it to run into.
 */

import { type Fragment, type Node, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type Selection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const isCode = (node: Node) => node.isTextblock && !!node.type.spec.code;

/** How deep `content` stays open along one side, to stop short of code. */
function openTo(
  content: Fragment,
  open: number,
  side: 'firstChild' | 'lastChild'
): number {
  let node = content[side];
  for (let depth = 1; node && depth <= open; depth += 1) {
    if (isCode(node)) return depth - 1;
    node = node[side];
  }
  return open;
}

/** `slice`, pasted at `selection`, with the code blocks at its sides closed. */
export function closeCodeEdges(
  slice: Slice,
  { $from, $to }: Pick<Selection, '$from' | '$to'>
): Slice {
  const rest = $to.parentOffset < $to.parent.content.size;
  if (!rest && $from.sameParent($to) && $from.parentOffset === 0) return slice;
  const lone = slice.content.childCount === 1 ? slice.content.firstChild : null;
  if (lone && isCode(lone) && !lone.textContent.includes('\n')) return slice;
  const openStart = openTo(slice.content, slice.openStart, 'firstChild');
  const openEnd = rest
    ? openTo(slice.content, slice.openEnd, 'lastChild')
    : slice.openEnd;
  if (openStart === slice.openStart && openEnd === slice.openEnd) return slice;
  return new Slice(slice.content, openStart, openEnd);
}

export const pasteCodeEdges = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/paste-code-edges'),
      props: {
        transformPasted: (slice, view) =>
          closeCodeEdges(slice, view.state.selection),
      },
    })
);
