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
 * is; it made it a plain code block, losing its language. The link button
 * there does nothing, as Cmd+K does: it opened the box for an address over
 * the code, and what was typed in it went nowhere, code holding no link.
 *
 * On an empty line of a list item the block takes the line's place, under the
 * item above, as one typed there does. The line stayed above the block as an
 * empty bullet, saved as `<br />`. The code block and quote buttons did
 * nothing on the first line of a list item, which has to stay text; the line
 * goes there as code or a quote too.
 *
 * The slash menu's image, rule, table and formula go in as the toolbar's do.
 * The image and the rule left the caret in the block after them, at the end
 * of the document the block itself selected, where what was typed next went
 * nowhere. The table and the formula, put in above a code block, gave the
 * caret to the code.
 */

import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { createTable } from '@milkdown/kit/preset/gfm';
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model';
import { TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { replaceLineWith } from './fence-input';
import { liftFromQuote } from './toolbar-toggles';

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

/**
 * The first line of a list item made code or a quote, under the item above,
 * the caret where it was in the line. False anywhere else.
 */
function itemLineInto(view: EditorView, type: 'code' | 'quote'): boolean {
  const { state } = view;
  const { $head, $anchor } = state.selection;
  const line = $head.parent;
  if (!$head.sameParent($anchor) || line.type.name !== 'paragraph')
    return false;
  if ($head.node(-1).type.name !== 'list_item' || $head.index(-1) > 0) {
    return false;
  }
  const { schema } = state;
  const text = line.textContent;
  const block =
    type === 'code'
      ? schema.nodes.code_block.create(null, text ? schema.text(text) : null)
      : schema.nodes.blockquote.create(null, line);
  const placed = replaceLineWith(state, block);
  if (!placed) return false;
  const { tr, at } = placed;
  const caret =
    type === 'code'
      ? at + 1 + Math.min($head.parentOffset, text.length)
      : at + 2 + $head.parentOffset;
  tr.setSelection(TextSelection.create(tr.doc, caret));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

type Item = { key: string; onRun?: (ctx: Ctx) => void };
type Builder = { build: () => { key: string; items: Item[] }[] };

const nodes = (ctx: Ctx) => ctx.get(editorViewCtx).state.schema.nodes;

const image = (ctx: Ctx) => nodes(ctx)['image-block'].create();
const table = (ctx: Ctx) => createTable(ctx, 3, 3);
const math = (ctx: Ctx) => nodes(ctx).code_block.create({ language: 'LaTeX' });
const rule = (ctx: Ctx) => nodes(ctx).hr.create();

/** The block each of these buttons adds, by its group and key. */
const BLOCKS: [group: string, key: string, make: (ctx: Ctx) => Node][] = [
  ['insert', 'image', image],
  ['insert', 'table', table],
  ['block', 'math', math],
  ['more', 'hr', rule],
];

/** The slash menu's items for the same blocks. */
const SLASH_BLOCKS: [group: string, key: string, make: (ctx: Ctx) => Node][] = [
  ['advanced', 'image', image],
  ['advanced', 'table', table],
  ['advanced', 'math', math],
  ['text', 'divider', rule],
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
  const link = find('insert', 'link');
  const toLink = link?.onRun;
  if (link && toLink) {
    link.onRun = (ctx) => {
      const { $from } = ctx.get(editorViewCtx).state.selection;
      if (!$from.parent.type.spec.code) toLink(ctx);
    };
  }
  const code = find('block', 'code-block');
  const toCode = code?.onRun;
  if (code && toCode) {
    code.onRun = (ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.state.selection.$from.parent.type.spec.code) return;
      if (!itemLineInto(view, 'code')) toCode(ctx);
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
      if (liftFromQuote(view.state, view.dispatch)) return;
      if (!itemLineInto(view, 'quote')) toQuote(ctx);
    };
  }
}

/** Has the slash menu's blocks above put in as the toolbar's are. */
export function intoSlashBlocks(builder: Builder) {
  const groups = builder.build();
  for (const [group, key, make] of SLASH_BLOCKS) {
    const item = groups
      .find((g) => g.key === group)
      ?.items.find((i) => i.key === key);
    if (!item) continue;
    item.onRun = (ctx) => {
      // The slash and what was typed after it go first, as Crepe's own do.
      ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
      insertBlock(ctx.get(editorViewCtx), make(ctx));
    };
  }
}
