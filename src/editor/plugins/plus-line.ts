/**
 * The line the block handle's "+" puts in under its block, for the slash
 * menu, goes again when the caret leaves it empty. Closing the menu with
 * Escape or a click elsewhere left the line in the document, saved as an
 * empty `<br />` line, one for each time the menu was opened and let go.
 *
 * Once anything is typed in it or a block is chosen for it, the line is
 * the document's like any other.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const key = new PluginKey<number[]>('ny-plus-line');
const ADD_BUTTON = '.milkdown-block-handle .operation-item:first-child';

function isEmptyLine(state: EditorState, pos: number): boolean {
  const node = state.doc.nodeAt(pos);
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

/**
 * The "+" lines after `tr`, given those before it. `added` says `tr` is the
 * "+" button's own, putting in an empty line with the caret on it.
 */
export function plusLinesAfter(
  lines: readonly number[],
  tr: Transaction,
  state: EditorState,
  added: boolean
): number[] {
  const kept: number[] = [];
  for (const line of lines) {
    const mapped = tr.mapping.mapResult(line, 1);
    if (!mapped.deleted && isEmptyLine(state, mapped.pos))
      kept.push(mapped.pos);
  }
  if (added) {
    const { $from } = state.selection;
    const line = $from.depth > 0 ? $from.before() : -1;
    if (line >= 0 && isEmptyLine(state, line) && !kept.includes(line)) {
      kept.push(line);
    }
  }
  return kept;
}

/** Takes out the "+" lines the selection is off, last first. */
export function dropLeftLines(
  state: EditorState,
  lines: readonly number[]
): Transaction | null {
  const { from, to } = state.selection;
  const left = lines
    .filter((line) => to <= line || from >= line + 2)
    .sort((a, b) => b - a);
  if (left.length === 0) return null;
  const tr = state.tr;
  for (const line of left) tr.delete(line, line + 2);
  return tr.setMeta(key, left);
}

export const plusLine = $prose(() => {
  // Set over the press on "+", whose handler puts the line in at once.
  let adding = false;
  return new Plugin<number[]>({
    key,
    state: {
      init: () => [],
      apply(tr, lines, _old, state) {
        const added = adding && tr.docChanged;
        if (added) adding = false;
        if (lines.length === 0 && !added) return lines;
        return plusLinesAfter(lines, tr, state, added);
      },
    },
    appendTransaction(_trs, _old, state) {
      const lines = key.getState(state) ?? [];
      return lines.length > 0 ? dropLeftLines(state, lines) : null;
    },
    view(view) {
      const doc = view.dom.ownerDocument;
      const mark = (event: Event) => {
        const target = event.target as Element | null;
        if (!target?.closest?.(ADD_BUTTON)) return;
        adding = true;
        window.setTimeout(() => {
          adding = false;
        });
      };
      doc.addEventListener('pointerup', mark, true);
      return {
        destroy() {
          doc.removeEventListener('pointerup', mark, true);
        },
      };
    },
  });
});
