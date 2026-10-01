/**
 * Keeps the caret in a list item while Crepe redraws the item. Its list item
 * draws the marker with Vue and, on every redraw -- a new number, a box
 * ticked, the item selected -- put the item's text back where it already was.
 * Moving it took the caret out of the text for a moment, and ProseMirror read
 * the caret from where it landed, between blocks, and put it at the end of the
 * block above. A code block there took the focus: "1. " typed under one, and
 * the next letters went into the code.
 *
 * The text is moved only when it is somewhere else.
 */

import { SchemaReady, nodeViewCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';

function keepTextInPlace(make: NodeViewConstructor): NodeViewConstructor {
  return (...args) => {
    const view = make(...args);
    const holder = view.contentDOM?.parentElement;
    if (holder) {
      const append = holder.appendChild.bind(holder);
      holder.appendChild = <T extends Node>(child: T): T =>
        holder.lastChild === (child as Node) ? child : append(child);
    }
    return view;
  };
}

export const listItemView: MilkdownPlugin = (ctx) => async () => {
  // Crepe's view is in by then: it registers as the schema becomes ready,
  // ahead of this.
  await ctx.wait(SchemaReady);
  ctx.update(nodeViewCtx, (views) =>
    views.map(([id, make]): [string, NodeViewConstructor] => [
      id,
      id === 'list_item' ? keepTextInPlace(make) : make,
    ])
  );
};
