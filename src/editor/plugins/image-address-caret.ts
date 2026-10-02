/**
 * An image given its address, typed or pasted into its box and confirmed, or
 * a file picked for it, gives the caret back to the text, on the line under
 * it. The box went as the picture came, and the focus with it: what was typed
 * next went nowhere until the text was clicked.
 */

import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { AttrStep } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';

/** True in the state left by the transaction that gave the caret back. */
const key = new PluginKey<boolean>('nyamark/image-address-caret');

/** Where `tr` gave an image block with no address one, or -1. */
export function addressedImage(tr: Transaction): number {
  if (tr.getMeta('history$') || tr.steps.length !== 1) return -1;
  const [step] = tr.steps;
  if (!(step instanceof AttrStep) || step.attr !== 'src' || !step.value) {
    return -1;
  }
  const image = tr.docs[0]?.nodeAt(step.pos);
  if (image?.type.name !== 'image-block' || image.attrs.src) return -1;
  return step.pos;
}

/** The caret on the line under the block at `pos`, a new one if none is. */
export function caretUnder(tr: Transaction, pos: number): Transaction {
  const block = tr.doc.nodeAt(pos);
  const { paragraph } = tr.doc.type.schema.nodes;
  if (!block || !paragraph) return tr;
  const after = pos + block.nodeSize;
  const next = tr.doc.nodeAt(after);
  if (!next?.isTextblock || next.type.spec.code) {
    const $after = tr.doc.resolve(after);
    const index = $after.index();
    if (!$after.parent.canReplaceWith(index, index, paragraph)) return tr;
    tr.insert(after, paragraph.create());
  }
  return tr.setSelection(TextSelection.create(tr.doc, after + 1));
}

export const imageAddressCaret = $prose(
  () =>
    new Plugin<boolean>({
      key,
      state: {
        init: () => false,
        apply: (tr) => tr.getMeta(key) === true,
      },
      appendTransaction(trs, _old, state) {
        let pos = -1;
        for (const tr of trs) {
          if (pos >= 0) pos = tr.mapping.map(pos);
          const at = addressedImage(tr);
          if (at >= 0) pos = at;
        }
        if (pos < 0 || state.doc.nodeAt(pos)?.type.name !== 'image-block') {
          return null;
        }
        return caretUnder(state.tr, pos).setMeta(key, true);
      },
      view: () => ({
        update(view, prev) {
          if (view.state === prev || !key.getState(view.state)) return;
          // After the key that confirmed the address is done with: the
          // editor focused while it is still down takes the Enter as its own,
          // a new line under the picture.
          setTimeout(() => view.focus());
        },
      }),
    })
);
