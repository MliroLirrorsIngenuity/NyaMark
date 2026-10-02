/**
 * A table or a formula put in from the toolbar takes the caret, as one put in
 * from the slash menu does. The caret stayed where it was when the button was
 * pressed: what was typed next after the table button went on in the line
 * above the table, and after the formula button in the line under the new
 * formula, which stood there as an empty grey box.
 *
 * A rule or an image puts the caret on the line under it. At the end of the
 * document there was none, the rule or the image was left selected, and the
 * first key typed took its place.
 *
 * In a code block or a table, a block put in goes in after it. It went in at
 * the caret, cutting the code block in two or the table, a row of it above
 * and the rest below. The code block button in a code block leaves it as it
 * is; it made it a plain code block, losing its language.
 *
 * On an empty line of a list item the block takes the line's place, under the
 * item above, as one typed there does. The line stayed above the block as an
 * empty bullet, saved as `<br />`.
 */

import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { createTable } from '@milkdown/kit/preset/gfm';
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model';
import { TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { replaceLineWith } from './fence-input';

/** The depth of the table or the code block `$pos` is in, or 0. */
function holder($pos: ResolvedPos): number {
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (node.type.name === 'table' || node.type.spec.code) return depth;
  }
  return 0;
}

/** Puts `node` in at the selection, as the toolbar does, and the caret in it. */
export function insertBlock(view: EditorView, node: Node) {
  const { state } = view;
  const { $from, empty } = state.selection;
  const depth = holder($from);
  const line = $from.parent;
  const emptyLine =
    empty && line.type.name === 'paragraph' && !line.content.size;
  let tr: Transaction | undefined;
  if (depth > 0) tr = state.tr.insert($from.after(depth), node);
  else if (emptyLine) tr = replaceLineWith(state, node)?.tr;
  tr ??= state.tr.replaceSelectionWith(node);
  let at = -1;
  tr.doc.descendants((child, pos) => {
    if (child === node) at = pos;
    return at < 0;
  });
  if (at >= 0 && node.isAtom) {
    const after = at + node.nodeSize;
    const next = tr.doc.resolve(after).nodeAfter;
    if (!next?.isTextblock || next.type.spec.code) {
      tr.insert(after, view.state.schema.nodes.paragraph.create());
    }
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  } else if (at >= 0) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

type Item = { key: string; onRun?: (ctx: Ctx) => void };
type Builder = { build: () => { key: string; items: Item[] }[] };

const nodes = (ctx: Ctx) => ctx.get(editorViewCtx).state.schema.nodes;

/** The block each of these buttons adds, by its group and key. */
const BLOCKS: [group: string, key: string, make: (ctx: Ctx) => Node][] = [
  ['insert', 'image', (ctx) => nodes(ctx)['image-block'].create()],
  ['insert', 'table', (ctx) => createTable(ctx, 3, 3)],
  [
    'block',
    'math',
    (ctx) => nodes(ctx).code_block.create({ language: 'LaTeX' }),
  ],
  ['more', 'hr', (ctx) => nodes(ctx).hr.create()],
];

/** Has the toolbar's block buttons put in their blocks as above. */
export function intoInsertedBlocks(builder: Builder) {
  const groups = builder.build();
  const find = (group: string, key: string) =>
    groups.find((g) => g.key === group)?.items.find((i) => i.key === key);
  for (const [group, key, make] of BLOCKS) {
    const item = find(group, key);
    if (!item) continue;
    item.onRun = (ctx) => insertBlock(ctx.get(editorViewCtx), make(ctx));
  }
  const code = find('block', 'code-block');
  const toCode = code?.onRun;
  if (code && toCode) {
    code.onRun = (ctx) => {
      const { $from } = ctx.get(editorViewCtx).state.selection;
      if (!$from.parent.type.spec.code) toCode(ctx);
    };
  }
  // A code block quoted is drawn anew. The old one had the focus as it went,
  // and the browser gave it to the new one with the caret at its start; with
  // the editor focused, the new one takes the caret from the editor.
  const quote = find('more', 'quote');
  const toQuote = quote?.onRun;
  if (quote && toQuote) {
    quote.onRun = (ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.state.selection.$from.parent.type.spec.code) {
        view.dom.focus({ preventScroll: true });
      }
      toQuote(ctx);
    };
  }
}
