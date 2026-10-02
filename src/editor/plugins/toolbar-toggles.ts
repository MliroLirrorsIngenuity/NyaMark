/**
 * The list and quote buttons of the toolbar toggle, and show where the caret
 * is. In a list, the button of another kind makes the list that kind, and its
 * own button takes the items the selection is in out of the list; in a quote,
 * the quote button takes the blocks out of it. The list buttons did nothing in
 * a list, a second click on the quote button put a quote in the quote, and no
 * button lit up for the list or the quote the caret was in.
 *
 * A list a button makes joins a list of its kind right before or after it:
 * an item taken out of a list and put back made a list of its own, set apart
 * from the items either side and saved with other bullets to keep it apart.
 */

import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { canJoin, liftTarget } from '@milkdown/kit/prose/transform';

export type ListKind = 'bullet' | 'ordered' | 'task';

type Dispatch = (tr: Transaction) => void;

/** The innermost list holding the whole selection, by depth, and its kind. */
export function listAt(
  state: EditorState
): { depth: number; kind: ListKind } | null {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    const list = $from.node(depth);
    const name = list.type.name;
    if (name !== 'bullet_list' && name !== 'ordered_list') continue;
    if ($to.depth <= depth || $to.before(depth) !== $from.before(depth)) {
      continue;
    }
    if (name === 'ordered_list') return { depth, kind: 'ordered' };
    const task = $from.node(depth + 1).attrs.checked != null;
    return { depth, kind: task ? 'task' : 'bullet' };
  }
  return null;
}

/**
 * The button of `kind` in a list: the list made that kind, or, already that
 * kind, the items the selection is in taken out of it. False outside a list.
 */
export function toggleList(
  state: EditorState,
  kind: ListKind,
  dispatch?: Dispatch
): boolean {
  const at = listAt(state);
  if (!at) return false;
  const { schema } = state;
  if (at.kind === kind) {
    liftListItem(schema.nodes.list_item)(state, dispatch);
    return true;
  }
  const pos = state.selection.$from.before(at.depth);
  const list = state.selection.$from.node(at.depth);
  const ordered = kind === 'ordered';
  const { spread } = list.attrs;
  const tr = state.tr.setNodeMarkup(
    pos,
    ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list,
    ordered ? { order: 1, spread } : { spread }
  );
  list.forEach((item, offset, index) => {
    tr.setNodeMarkup(pos + 1 + offset, undefined, {
      ...item.attrs,
      listType: ordered ? 'ordered' : 'bullet',
      label: ordered ? `${index + 1}.` : '•',
      checked: kind === 'task' ? (item.attrs.checked ?? false) : null,
    });
  });
  dispatch?.(tr.scrollIntoView());
  return true;
}

/** The kind of list `node` is, if it is one. */
function kindOf(node: Node | null | undefined): ListKind | null {
  if (node?.type.name === 'ordered_list') return 'ordered';
  if (node?.type.name !== 'bullet_list') return null;
  return node.firstChild?.attrs.checked != null ? 'task' : 'bullet';
}

/** The list the selection is in joined to lists of its kind either side. */
export function joinNeighbours(
  state: EditorState,
  dispatch?: Dispatch
): boolean {
  const at = listAt(state);
  if (!at) return false;
  const { $from } = state.selection;
  const start = $from.before(at.depth);
  const end = $from.after(at.depth);
  const { tr } = state;
  const after = tr.doc.resolve(end).nodeAfter;
  if (kindOf(after) === at.kind && canJoin(tr.doc, end)) tr.join(end);
  const before = tr.doc.resolve(start).nodeBefore;
  if (kindOf(before) === at.kind && canJoin(tr.doc, start)) tr.join(start);
  if (!tr.docChanged) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
}

const isQuote = (node: { type: { name: string } }) =>
  node.type.name === 'blockquote';

/** Whether the selection is in a quote. */
export function inQuote(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return !!$from.blockRange($to, isQuote);
}

/** The blocks the selection is in taken out of the innermost quote. */
export function liftFromQuote(
  state: EditorState,
  dispatch?: Dispatch
): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, isQuote);
  const target = range && liftTarget(range);
  if (!range || target == null) return false;
  dispatch?.(state.tr.lift(range, target).scrollIntoView());
  return true;
}

type Item = {
  key: string;
  active?: (ctx: Ctx) => boolean;
  onRun?: (ctx: Ctx) => void;
};
export type Builder = { build: () => { key: string; items: Item[] }[] };

const LISTS: [key: string, kind: ListKind][] = [
  ['bullet-list', 'bullet'],
  ['ordered-list', 'ordered'],
  ['task-list', 'task'],
];

/** Has the toolbar's list buttons toggle, and light them and the quote's up. */
export function intoToggles(builder: Builder) {
  const groups = builder.build();
  const find = (group: string, key: string) =>
    groups.find((g) => g.key === group)?.items.find((i) => i.key === key);
  const state = (ctx: Ctx) => ctx.get(editorViewCtx).state;
  for (const [key, kind] of LISTS) {
    const item = find('list', key);
    const wrap = item?.onRun;
    if (!item || !wrap) continue;
    item.active = (ctx) => listAt(state(ctx))?.kind === kind;
    item.onRun = (ctx) => {
      const view = ctx.get(editorViewCtx);
      const lifts = listAt(view.state)?.kind === kind;
      if (!toggleList(view.state, kind, view.dispatch)) wrap(ctx);
      if (!lifts) joinNeighbours(view.state, view.dispatch);
      view.focus();
    };
  }
  const quote = find('more', 'quote');
  if (quote) quote.active = (ctx) => inQuote(state(ctx));
}
