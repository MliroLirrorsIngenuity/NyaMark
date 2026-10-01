/**
 * The block handle stands by blocks only.
 *
 * Crepe looks for the node under the pointer and takes it as the block unless
 * it opens its line. Over an inline atom further along, such as the `<kbd>`
 * tag of `按 <kbd>Ctrl</kbd>` or inline math, the handle stood in the middle of
 * the line, over the text, and its drag took the atom alone.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { blockConfig } from '@milkdown/kit/plugin/block';

/** `editor.config` hook: an inline node passes the handle on to its block. */
export function handleBlocksOnly(ctx: Ctx) {
  ctx.update(blockConfig.key, ({ filterNodes }) => ({
    filterNodes: (pos, node) => !node.isInline && filterNodes(pos, node),
  }));
}
