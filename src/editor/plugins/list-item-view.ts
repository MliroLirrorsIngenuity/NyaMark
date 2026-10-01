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
 *
 * A frame after each redraw the item also puts back the selection it saw as
 * it drew. An item redrawn as a block was selected whole from its handle, the
 * item itself or one picked after it, put that selection back as text running
 * over the block: the format bar came up over a block picked up to be moved.
 * A block selected whole stays so.
 */

import { SchemaReady, nodeViewCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

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

export const keepListItemSelected = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/list-item-selected'),
      filterTransaction(tr, state) {
        const { selection } = state;
        if (!(selection instanceof NodeSelection)) return true;
        if (!selection.node.isBlock) return true;
        if (tr.docChanged || !tr.selectionSet) return true;
        const next = tr.selection;
        return !(
          next instanceof TextSelection &&
          next.from === selection.from &&
          next.to === selection.to
        );
      },
    })
);
