/**
 * Inline code holds text only.
 *
 * A code span holds no line break, image or formula, and Milkdown wrote the
 * code mark over one as an empty span in its place: a break typed between
 * backticks was saved as `` `a````b` ``, and an image in text made code with
 * Mod+E was gone from the file. The mark comes off anything in a line other
 * than its characters, wherever it was put on.
 */

import type { Mark, Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** Takes the code mark off what lies in `from`..`to` of `state` other than text. */
export function uncodeLeaves(
  state: EditorState,
  from: number,
  to: number
): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.nodesBetween(from, to, (node: Node, pos: number) => {
    if (!node.isInline || node.isText) return;
    for (const mark of node.marks as readonly Mark[]) {
      if (!mark.type.spec.code) continue;
      tr ??= state.tr;
      tr.removeMark(pos, pos + node.nodeSize, mark);
    }
  });
  return tr;
}

export const inlineCodeText = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/inline-code-text'),
      appendTransaction(trs, old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const start = old.doc.content.findDiffStart(state.doc.content);
        if (start == null) return null;
        const end = old.doc.content.findDiffEnd(state.doc.content);
        const tr = uncodeLeaves(state, start, Math.max(start, end?.b ?? start));
        // A step forgets the marks set for what is typed next: after the
        // closing backtick, the text typed went on in code.
        if (tr && state.storedMarks) tr.setStoredMarks(state.storedMarks);
        return tr;
      },
    })
);
