/**
 * Search matches inside code blocks. CodeMirror draws the code and ignores
 * ProseMirror's decorations, so a match in code was counted and scrolled to
 * with nothing to show where it was. Each block is handed its own matches
 * and marks them with the classes the rest of the document uses.
 */

import { StateEffect, StateField } from '@codemirror/state';
import {
  EditorView as CodeMirror,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import type { EditorView } from '@milkdown/kit/prose/view';

export type CodeMatch = { from: number; to: number; active: boolean };

const setMatches = StateEffect.define<CodeMatch[]>();
const match = Decoration.mark({ class: 'ny-search-match' });
const activeMatch = Decoration.mark({
  class: 'ny-search-match ny-search-match--active',
});

/** A code block's extension: the matches it was last handed. */
export const codeSearchMatches = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMatches)) continue;
      next = Decoration.set(
        effect.value.map(({ from, to, active }) =>
          (active ? activeMatch : match).range(from, to)
        ),
        true
      );
    }
    return next;
  },
  provide: (field) => CodeMirror.decorations.from(field),
});

/** Hands every code block in `view` the matches inside it. */
export function showCodeMatches(
  view: EditorView,
  matches: readonly { from: number; to: number }[],
  active: number
) {
  view.state.doc.descendants((node, pos) => {
    if (!node.type.spec.code) return !node.isTextblock;
    const dom = view.nodeDOM(pos);
    const editor =
      dom instanceof HTMLElement ? dom.querySelector('.cm-editor') : null;
    const cm =
      editor instanceof HTMLElement ? CodeMirror.findFromDOM(editor) : null;
    const shown = cm?.state.field(codeSearchMatches, false);
    if (!cm || !shown) return false;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    const inside: CodeMatch[] = [];
    matches.forEach(({ from, to }, index) => {
      if (from >= start && to <= end) {
        inside.push({
          from: from - start,
          to: to - start,
          active: index === active,
        });
      }
    });
    if (inside.length > 0 || shown.size > 0) {
      cm.dispatch({ effects: setMatches.of(inside) });
    }
    return false;
  });
}

/**
 * Where the line of code holding `pos` is laid out, or null outside code.
 * ProseMirror puts every place in a code block at the block's top, and
 * CodeMirror draws only the lines in sight: a match far down a long block
 * was taken to be on screen with the block's top.
 */
export function codeLineBox(view: EditorView, pos: number) {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.type.spec.code) return null;
  const dom = view.nodeDOM($pos.before());
  const editor =
    dom instanceof HTMLElement ? dom.querySelector('.cm-editor') : null;
  const cm =
    editor instanceof HTMLElement ? CodeMirror.findFromDOM(editor) : null;
  if (!cm) return null;
  const line = cm.lineBlockAt(pos - $pos.start());
  return {
    top: cm.documentTop + line.top,
    bottom: cm.documentTop + line.bottom,
  };
}
