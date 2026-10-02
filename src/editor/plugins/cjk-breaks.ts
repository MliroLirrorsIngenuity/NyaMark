/**
 * A line break of the Markdown between two Chinese or Japanese characters is
 * drawn as nothing, as CSS sets out for East Asian text: the line runs on into
 * the next with no gap. It was drawn as a space, so a quote written over two
 * lines read `引用的一段话， 第二行。`. Next to any other character it stays a
 * space, as between two words.
 *
 * ← and → pass over such a break with the character beside it, and Backspace
 * or Delete next to it takes that character: the caret stood still for a
 * press while it went over the break, and Backspace took the break with
 * nothing to show it.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

// East Asian Wide, Fullwidth and Halfwidth (UAX #11), Hangul left out as CSS
// leaves it: Korean puts spaces between its words.
const WIDE =
  /^[⺀-⿟⿰-〿぀-ヿ㄀-ㄯ㆐-㏿㐀-䶿一-鿿豈-﫿︐-︟︰-﹯！-ﾟ￠-￦\u{20000}-\u{3FFFD}]$/u;

const softBreak = (node: ProseNode | null | undefined) =>
  node?.type.name === 'hardbreak' && node.attrs.isInline === true;

/** The last character of `node`'s text, or its first with `first`. */
function edgeChar(node: ProseNode | null | undefined, first: boolean) {
  if (!node?.isText || !node.text) return '';
  const chars = Array.from(first ? node.text.slice(0, 2) : node.text.slice(-2));
  return (first ? chars[0] : chars[chars.length - 1]) ?? '';
}

/**
 * The characters on either side of the break at `pos`, when it is a soft
 * break drawn as nothing; null otherwise.
 */
export function joinedBreakAt(
  doc: ProseNode,
  pos: number
): [string, string] | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if (!softBreak($pos.nodeAfter)) return null;
  const before = edgeChar($pos.nodeBefore, false);
  const after = edgeChar(doc.resolve(pos + 1).nodeAfter, true);
  return WIDE.test(before) && WIDE.test(after) ? [before, after] : null;
}

/** Where the breaks drawn as nothing are in the textblock at `pos`. */
function joinedIn(doc: ProseNode, block: ProseNode, pos: number): number[] {
  const found: number[] = [];
  block.forEach((child, offset) => {
    const at = pos + 1 + offset;
    if (softBreak(child) && joinedBreakAt(doc, at)) found.push(at);
  });
  return found;
}

const hidden = (at: number) =>
  Decoration.node(at, at + 1, { class: 'ny-break-joined' });

export function joinedBreaks(doc: ProseNode): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(...joinedIn(doc, node, pos));
    return false;
  });
  return found;
}

/** The decorations of the textblocks `tr` touched, worked out again. */
function update(tr: Transaction, previous: DecorationSet): DecorationSet {
  const { doc, mapping } = tr;
  let set = previous.map(mapping, doc);
  mapping.maps.forEach((map, index) => {
    const rest = mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, start, end) => {
      const from = rest.map(start, -1);
      const to = rest.map(end, 1);
      doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        const stale = set.find(pos + 1, pos + node.nodeSize - 1);
        set = set.remove(stale).add(doc, joinedIn(doc, node, pos).map(hidden));
        return false;
      });
    });
  });
  return set;
}

/**
 * The selection or deletion for `key` beside a break drawn as nothing, or
 * null where the key does as it always does.
 */
export function overJoinedBreak(
  state: EditorState,
  key: string,
  shift: boolean
): Transaction | null {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection)) return null;
  const { head } = selection;
  const left = key === 'ArrowLeft' || key === 'Backspace';
  const at = left ? head - 1 : head;
  const sides = joinedBreakAt(doc, at);
  if (!sides) return null;
  const char = left ? sides[0] : sides[1];
  if (key === 'Backspace' || key === 'Delete') {
    if (!selection.empty || shift) return null;
    return left
      ? state.tr.delete(at - char.length, at)
      : state.tr.delete(at + 1, at + 1 + char.length);
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  if (!selection.empty && !shift) return null;
  const to = left ? at - char.length : at + 1 + char.length;
  const anchor = shift ? selection.anchor : to;
  return state.tr.setSelection(TextSelection.create(doc, anchor, to));
}

const key = new PluginKey<DecorationSet>('nyamark/cjk-breaks');

export const cjkBreaks = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, { doc }) =>
          DecorationSet.create(doc, joinedBreaks(doc).map(hidden)),
        apply: (tr, previous) =>
          tr.docChanged ? update(tr, previous) : previous,
      },
      props: {
        decorations: (state) => key.getState(state),
        handleKeyDown(view, event) {
          if (event.altKey || event.ctrlKey || event.metaKey) return false;
          if (event.isComposing) return false;
          const tr = overJoinedBreak(view.state, event.key, event.shiftKey);
          if (!tr) return false;
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    })
);
