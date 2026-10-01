/**
 * A rule and an image typed in Markdown take effect before their line ends,
 * on the third dash and on the closing parenthesis, and put the caret on the
 * line below them. Elsewhere a line typed in Markdown takes effect on Enter,
 * as a fence, `$$` or a table's first row does, so Enter followed out of
 * habit and left an empty line under the rule or the image, saved as
 * `<br />`. An Enter that comes straight after, with the caret where the
 * block put it, is taken as that one.
 */

import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** Where a block just typed put the caret, until anything else happens. */
const lineBelow = new PluginKey<number | null>('nyamark/typed-block-enter');

/** Marks `tr`, which typed a block, as leaving the caret at `pos` below it. */
export function caretBelowTypedBlock(tr: Transaction, pos: number) {
  return tr.setMeta(lineBelow, pos);
}

export const enterAfterTypedBlock = $prose(
  () =>
    new Plugin<number | null>({
      key: lineBelow,
      state: {
        init: () => null,
        apply(tr, at) {
          const meta = tr.getMeta(lineBelow) as number | null | undefined;
          if (meta !== undefined) return meta;
          return tr.docChanged || tr.selectionSet ? null : at;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || event.isComposing) return false;
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
            return false;
          const at = lineBelow.getState(view.state);
          const { selection } = view.state;
          if (at == null || !selection.empty || selection.head !== at)
            return false;
          view.dispatch(view.state.tr.setMeta(lineBelow, null));
          return true;
        },
      },
    })
);
