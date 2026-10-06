/**
 * A code block ends where its closing fence is typed on its last line, and
 * Enter. The fence line goes and the caret moves on to the line under the
 * block, as the Markdown typed reads. Enter only ever added lines to the
 * code: the fence stayed in it as text, and the way out was ArrowDown.
 *
 * The line closes the block if it would close it in the file: ``` under code
 * saved between ``` lines, `$$` under a formula. Code holding a fence of its
 * own, as a Markdown sample does, is saved between longer ones, so a fence
 * closing one opened inside the code stays a line of it.
 */

import { Prec } from '@codemirror/state';
import { type EditorView as CodeMirror, keymap } from '@codemirror/view';
import type { Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Parse } from './typed-blocks';

/**
 * Whether `line`, typed under a block's code, closes the block: `saved` is
 * the block without the line, as a save writes it, and the line closes it if
 * it reads there as the block's closing fence.
 */
export function closesAs(saved: string, line: string, parse: Parse): boolean {
  const [block] = parse(saved).children;
  const end = block?.position?.end.offset;
  // An empty line adds none to the Markdown: it ends the one above.
  if (!line || !block || !('value' in block) || end === undefined) {
    return false;
  }
  const typed = saved.slice(0, saved.lastIndexOf('\n', end - 1) + 1) + line;
  const [read] = parse(typed).children;
  return (
    read?.type === block.type && 'value' in read && read.value === block.value
  );
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

export function codeBlockPos(
  view: EditorView,
  dom: HTMLElement
): number | null {
  const found: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (found.length) return false;
    if (node.type.name !== 'code_block') return !node.isTextblock;
    if (view.nodeDOM(pos)?.contains(dom)) found.push(pos);
    return false;
  });
  return found[0] ?? null;
}

/** Markdown as the editor reads and writes a file. */
export type Markdown = { parse: Parse; serialize: (doc: Node) => string };

export function closeFenceOnEnter(
  getView: () => EditorView | null,
  markdown: Markdown
) {
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
          const keep = Math.max(last.from - 1, 0);
          const { schema } = view.state;
          const code = doc.sliceString(0, keep);
          const before = block.type.create(
            block.attrs,
            code ? schema.text(code) : null
          );
          const saved = markdown.serialize(
            schema.topNodeType.create(null, before)
          );
          if (!closesAs(saved, last.text, markdown.parse)) return false;
          const tr = leaveCodeAt(view.state, pos, keep);
          if (!tr) return false;
          view.dispatch(tr);
          view.focus();
          return true;
        },
      },
    ])
  );
}
