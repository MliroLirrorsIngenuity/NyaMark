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
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm';
import type { DOMOutputSpec, NodeSpec } from '@milkdown/kit/prose/model';

const ALIGNMENTS = ['left', 'center', 'right'];

export function alignmentFromDOM(dom: HTMLElement): string | null {
  const align = dom.style.textAlign;
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
