/**
 * A code block ends where its closing fence is typed: ``` or ~~~ on its last
 * line, `$$` in a formula, and Enter. The fence line goes and the caret moves
 * on to the line under the block, as the Markdown typed reads. Enter only
 * ever added lines to the code: the fence stayed in it as text, and the way
 * out was ArrowDown.
 *
 * A fence closing one opened inside the code, as in a Markdown sample, stays
 * a line of the code.
 */

import { Prec } from '@codemirror/state';
import { type EditorView as CodeMirror, keymap } from '@codemirror/view';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

const FENCE = /^\s*(?:`{3,}|~{3,})/;

/** Whether the code's last line closes the block it is typed in. */
export function endsInClosingFence(code: string, math: boolean): boolean {
  const lines = code.split('\n');
  const last = (lines.pop() ?? '').trim();
  if (math) return last === '$$';
  if (!/^(?:`{3,}|~{3,})$/.test(last)) return false;
  return lines.filter((line) => FENCE.test(line)).length % 2 === 0;
}

/** The code block at `pos` cut to its first `keep` characters, the caret under it. */
export function leaveCodeAt(
  state: EditorState,
  pos: number,
  keep: number
): Transaction | null {
  const block = state.doc.nodeAt(pos);
  const { paragraph } = state.schema.nodes;
  if (!block || !paragraph) return null;
  const tr = state.tr.delete(pos + 1 + keep, pos + block.nodeSize - 1);
  const after = tr.mapping.map(pos + block.nodeSize);
  const next = tr.doc.nodeAt(after);
  // An empty line already under the block, as at the end of a document, is
  // the one: another would be saved as a stray `<br />`.
  if (next?.type !== paragraph || next.content.size > 0) {
    tr.insert(after, paragraph.create());
  }
  return tr
    .setSelection(TextSelection.create(tr.doc, after + 1))
    .scrollIntoView();
}

function codeBlockPos(view: EditorView, dom: HTMLElement): number | null {
  const found: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (found.length) return false;
    if (node.type.name !== 'code_block') return !node.isTextblock;
    if (view.nodeDOM(pos)?.contains(dom)) found.push(pos);
    return false;
  });
  return found[0] ?? null;
}

export function closeFenceOnEnter(getView: () => EditorView | null) {
  return Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run: (cm: CodeMirror) => {
          const { doc, selection } = cm.state;
          const last = doc.line(doc.lines);
          const { main } = selection;
          if (selection.ranges.length > 1 || !main.empty) return false;
          if (main.head < last.from) return false;
          const view = getView();
          const pos = view && codeBlockPos(view, cm.dom);
          const block = pos == null ? null : view?.state.doc.nodeAt(pos);
          if (!view || pos == null || !block) return false;
          const language = String(block.attrs.language ?? '').toLowerCase();
          if (!endsInClosingFence(doc.toString(), language === 'latex')) {
            return false;
          }
          const tr = leaveCodeAt(view.state, pos, Math.max(last.from - 1, 0));
          if (!tr) return false;
          view.dispatch(tr);
          view.focus();
          return true;
        },
      },
    ])
  );
}
