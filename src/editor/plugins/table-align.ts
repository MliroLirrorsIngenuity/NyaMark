/**
 * Keeps a table column without an alignment unaligned through copy and paste.
 * Both go through the DOM, where Milkdown wrote every cell `text-align: left`
 * and read a cell without one back as left, so `| --- |` pasted came back
 * `| :- |`: a table copied in the document, pasted as Markdown, or from a web
 * page. A cell without an alignment is now drawn without one, and the
 * stylesheet keeps it to the left.
 *
 * A new table or column starts unaligned too, as one typed from `| a | b |`
 * does; they were written `| :- |`.
 *
 * A page made from Markdown, as on GitHub, aligns a cell with its `align`
 * attribute, which is read as well: a centred column pasted from one came in
 * unaligned.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm';
import type {
  DOMOutputSpec,
  NodeSpec,
  Node as ProseNode,
} from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const ALIGNMENTS = ['left', 'center', 'right'];

export function alignmentFromDOM(dom: HTMLElement): string | null {
  const align =
    dom.style.textAlign || dom.getAttribute('align')?.toLowerCase() || '';
  return ALIGNMENTS.includes(align) ? align : null;
}

function keepUnaligned<T extends NodeSpec>(spec: T): T {
  const { toDOM } = spec;
  return {
    ...spec,
    attrs: {
      ...spec.attrs,
      alignment: { ...spec.attrs?.alignment, default: null },
    },
    parseDOM: spec.parseDOM?.map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement) => {
        const attrs = rule.getAttrs?.(dom);
        if (attrs === false) return false;
        return { ...attrs, alignment: alignmentFromDOM(dom) };
      },
    })),
    toDOM: (node) => {
      const out = toDOM?.(node) as DOMOutputSpec;
      if (node.attrs.alignment != null || !Array.isArray(out)) return out;
      const [tag, { style: _, ...attrs }, ...rest] = out;
      return [tag, attrs, ...rest];
    },
  };
}

/** `editor.config` hook. */
export function keepCellAlignment(ctx: Ctx) {
  for (const schema of [tableCellSchema, tableHeaderSchema]) {
    ctx.update(
      schema.key,
      (base) => (schemaCtx) => keepUnaligned(base(schemaCtx))
    );
  }
}

export function alignCellsToHeaders(
  oldState: EditorState,
  state: EditorState
): Transaction | null {
  const before = oldState.doc;
  const { doc } = state;
  if (before === doc) return null;
  const from = before.content.findDiffStart(doc.content);
  if (from == null) return null;
  const end = before.content.findDiffEnd(doc.content);
  const to = Math.max(from, end?.b ?? doc.content.size);
  let tr: Transaction | null = null;
  doc.nodesBetween(from, Math.min(to + 1, doc.content.size), (node, pos) => {
    if (node.type.name !== 'table') return true;
    for (const [cell, at, alignment] of misalignedCells(node, pos)) {
      tr ??= state.tr;
      tr.setNodeMarkup(at, undefined, { ...cell.attrs, alignment });
    }
    return false;
  });
  return tr;
}

function misalignedCells(table: ProseNode, pos: number) {
  const out: [ProseNode, number, unknown][] = [];
  const header = table.firstChild;
  if (!header) return out;
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset, index) => {
      if (cell.type.name !== 'table_cell') return;
      const headerCell = header.maybeChild(index);
      if (!headerCell) return;
      const align = headerCell.attrs.alignment;
      if (align === cell.attrs.alignment) return;
      out.push([cell, pos + 1 + rowOffset + 1 + cellOffset, align]);
    });
  });
  return out;
}

export const keepTableAlign = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/table-align'),
      appendTransaction: (_trs, oldState, state) =>
        alignCellsToHeaders(oldState, state),
    })
);
