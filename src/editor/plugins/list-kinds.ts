/**
 * A bulleted list keeps the numbered items it takes in apart. Text typed over
 * a selection from a bulleted list into a numbered one, or the selection cut
 * or deleted, left the numbered items after it in the bulleted list: they
 * were drawn with their numbers and saved with bullets. They go on in a
 * numbered list of their own, numbered from one.
 *
 * A numbered list takes in bulleted items as numbered ones, and they are
 * drawn and saved so.
 */

import type { Node } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const numbered = (item: Node) => item.attrs.listType === 'ordered';

/** The bulleted lists split where their items change kind, or null. */
export function splitMixedLists(state: EditorState): Transaction | null {
  const { bullet_list: bullets, ordered_list: numbers } = state.schema.nodes;
  const cuts: { at: number; numbered: boolean; spread: unknown }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    // A list numbered from its first item is Milkdown's to number whole.
    if (node.type !== bullets || numbered(node.child(0))) return true;
    node.forEach((item, offset, index) => {
      if (index > 0 && numbered(item) !== numbered(node.child(index - 1))) {
        cuts.push({
          at: pos + 1 + offset,
          numbered: numbered(item),
          spread: node.attrs.spread,
        });
      }
    });
    return true;
  });
  if (cuts.length === 0) return null;
  const { tr } = state;
  // From the last, so the places of the others stand.
  cuts.sort((a, b) => b.at - a.at);
  for (const cut of cuts) {
    tr.split(cut.at, 1, [
      cut.numbered
        ? { type: numbers, attrs: { order: 1, spread: cut.spread } }
        : { type: bullets, attrs: { spread: cut.spread } },
    ]);
  }
  tr.doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (node.type !== numbers) return true;
    node.forEach((item, offset, index) => {
      const label = `${index + node.attrs.order}.`;
      if (item.attrs.label !== label) {
        tr.setNodeMarkup(pos + 1 + offset, null, { ...item.attrs, label });
      }
    });
    return true;
  });
  return tr;
}

export const listKinds = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/list-kinds'),
      appendTransaction: (trs, _old, state) =>
        trs.some((tr) => tr.docChanged) ? splitMixedLists(state) : null,
    })
);
