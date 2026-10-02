/**
 * Cmd+K opens the box a link's address is typed in, as the toolbar's link
 * button does: for the text selected, or at the caret for an address to go in
 * as its own text (see link-box). In a link, or over part of one, it opens
 * with the link's address to change, for the whole of the link. Cmd+K did
 * nothing, where other editors make a link with it.
 */

import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { Mark, MarkType } from '@milkdown/kit/prose/model';
import { type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

type Span = { from: number; to: number };
type LinkSpan = Span & { mark: Mark };

/** Each run of text under one link in the selection's line. */
function linksInLine(state: EditorState, type: MarkType): LinkSpan[] {
  const { $from } = state.selection;
  const start = $from.start();
  const runs: LinkSpan[] = [];
  $from.parent.forEach((child, offset) => {
    const mark = type.isInSet(child.marks);
    if (!mark) return;
    const from = start + offset;
    const to = from + child.nodeSize;
    const last = runs[runs.length - 1];
    if (last && last.to === from && last.mark.eq(mark)) last.to = to;
    else runs.push({ from, to, mark });
  });
  return runs;
}

/**
 * Where Cmd+K puts a link and the link it changes, if one: the link the
 * selection lies in, the caret at either end of it counted; otherwise the
 * selection. Null where there is no line of text to link.
 */
export function linkKeySpan(
  state: EditorState
): (Span & { mark: Mark | null }) | null {
  const { selection } = state;
  const type = state.schema.marks.link;
  if (!type || !(selection instanceof TextSelection)) return null;
  const { $from, $to, from, to } = selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  if ($from.sameParent($to)) {
    const link = linksInLine(state, type).find(
      (run) => run.from <= from && to <= run.to
    );
    if (link) return link;
  }
  return { from, to, mark: null };
}

export const linkKey = $prose((ctx) =>
  keymap({
    'Mod-k': (state) => {
      const span = linkKeySpan(state);
      if (!span) return false;
      const api = ctx.get(linkTooltipAPI.key);
      if (span.mark) api.editLink(span.mark, span.from, span.to);
      else api.addLink(span.from, span.to);
      return true;
    },
  })
);
