/**
 * A table or a formula put in from the toolbar takes the caret, as one put in
 * from the slash menu does. The caret stayed where it was when the button was
 * pressed: what was typed next after the table button went on in the line
 * above the table, and after the formula button in the line under the new
 * formula, which stood there as an empty grey box.
 */

import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { createTable } from '@milkdown/kit/preset/gfm';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/** Puts `node` in at the selection, as the toolbar does, and the caret in it. */
export function insertBlock(view: EditorView, node: Node) {
  const tr = view.state.tr.replaceSelectionWith(node);
  let at = -1;
  tr.doc.descendants((child, pos) => {
    if (child === node) at = pos;
    return at < 0;
  });
  if (at >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

type Item = { key: string; onRun?: (ctx: Ctx) => void };
type Builder = { build: () => { key: string; items: Item[] }[] };

/** The block each of these buttons adds, by its group and key. */
const BLOCKS: [group: string, key: string, make: (ctx: Ctx) => Node][] = [
  ['insert', 'table', (ctx) => createTable(ctx, 3, 3)],
  [
    'block',
    'math',
    (ctx) =>
      ctx
        .get(editorViewCtx)
        .state.schema.nodes.code_block.create({ language: 'LaTeX' }),
  ],
];

/** Has the toolbar's table and formula buttons put the caret in what they add. */
export function intoInsertedBlocks(builder: Builder) {
  const groups = builder.build();
  for (const [group, key, make] of BLOCKS) {
    const items = groups.find((g) => g.key === group)?.items ?? [];
    const item = items.find((i) => i.key === key);
    if (!item) continue;
    item.onRun = (ctx) => insertBlock(ctx.get(editorViewCtx), make(ctx));
  }
}
