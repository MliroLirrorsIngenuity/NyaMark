/**
 * Backspace at the start of a block and Delete at its end.
 *
 * Milkdown binds Backspace to "join this textblock to the one before it",
 * whatever lies in between:
 *
 * - at the start of a quote, the quoted text ran into the paragraph above;
 * - at the start of a list's first item, the list was merged into a list just
 *   above it (an ordered list turned into bullets) or moved into a quote above;
 * - after a code or math block, the paragraph ran into the code.
 *
 * Here the quote and the list let go of the block instead, the way Backspace
 * at the start of a heading turns it into a paragraph, and a paragraph after
 * code moves the caret to the end of the code. An empty paragraph after code
 * is still removed by Milkdown's join.
 *
 * Delete at the end of a paragraph pulled the code block below into it: the
 * code became text and the block was gone. It moves the caret into the code
 * instead, and an empty paragraph is removed on the way.
 *
 * Next to a table, either key selected the whole table and the next press
 * deleted it: two presses, or a held key running past the paragraph, took
 * the table with them. The caret goes into the table instead, to the end of
 * its last cell or the start of its first, as it goes into code.
 *
 * Delete at the end of a paragraph took a rule or an image below it at once,
 * where Backspace under one selects it first. Delete selects it too, so the
 * next press is the one that takes it, and the caret is left at the end of
 * the paragraph again: Milkdown put it on the line after.
 *
 * An HTML block sits alone in a paragraph, and either key next to it ran the
 * text beside it into that paragraph: the block turned into its source in a
 * line of text. It is selected instead, as a rule or an image is, and taken
 * on the next press. An empty line next to it goes first, as it does next to
 * an image.
 *
 * At the start of a heading Milkdown took both keys to step the level down,
 * h2 to h1 and h1 to text: `## ` typed by mistake and Backspace gave a bigger
 * heading, and Delete there never took the letter after the caret. Backspace
 * makes the heading a paragraph in one press, and Delete deletes.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { headingKeymap } from '@milkdown/kit/preset/commonmark';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';
import {
  isHtmlBlock,
  isHtmlBlockSelected,
  selectHtmlBlockAt,
} from './html-block';

function headingToParagraph(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const { paragraph } = state.schema.nodes;
  if ($from.parent.type.name !== 'heading' || !paragraph) return null;
  return state.tr.setBlockType($from.pos, $from.pos, paragraph);
}

/** The first item of a list that is not itself nested in a list item. */
function liftFirstItem(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth < 3) return null;
  const item = $from.node(depth - 1);
  if (item.type.name !== 'list_item') return null;
  if ($from.index(depth - 1) !== 0 || $from.index(depth - 2) !== 0) {
    return null;
  }
  // A nested list's first item already becomes a paragraph of its parent.
  if ($from.node(depth - 3).type.name === 'list_item') return null;
  let lifted: Transaction | null = null;
  liftListItem(item.type)(state, (tr) => {
    lifted = tr;
  });
  return lifted;
}

function liftOutOfQuote(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  const depth = $from.depth;
  if (depth < 2 || $from.node(depth - 1).type.name !== 'blockquote') {
    return null;
  }
  if ($from.index(depth - 1) !== 0) return null;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  return range && target != null ? state.tr.lift(range, target) : null;
}

/** Where a join would land: the end of the textblock before the caret's. */
function endOfTextblockBefore(state: EditorState) {
  const { $from } = state.selection;
  let cut = -1;
  for (let d = $from.depth - 1; d >= 0; d -= 1) {
    if ($from.index(d) > 0) {
      cut = $from.before(d + 1);
      break;
    }
    if ($from.node(d).type.spec.isolating) return null;
  }
  if (cut < 0) return null;
  let node = state.doc.resolve(cut).nodeBefore;
  let end = cut - 1;
  while (node && !node.isTextblock) {
    if (node.type.spec.isolating) return null;
    node = node.lastChild;
    end -= 1;
  }
  return node ? { node, end } : null;
}

function stopAtCode(state: EditorState): Transaction | null {
  if (state.selection.$from.parent.content.size === 0) return null;
  const before = endOfTextblockBefore(state);
  if (!before?.node.type.spec.code) return null;
  return state.tr.setSelection(TextSelection.create(state.doc, before.end));
}

/** The text in the table next to the caret's textblock, on the side of `dir`. */
function intoTable(state: EditorState, dir: 1 | -1): Transaction | null {
  const { $from } = state.selection;
  const index = $from.index(-1) + (dir > 0 ? 1 : -1);
  const parent = $from.node(-1);
  if (index < 0 || index >= parent.childCount) return null;
  if (parent.child(index).type.name !== 'table') return null;
  const tr = state.tr;
  // A paragraph emptied on the way goes, as a join would take it.
  if ($from.parent.content.size === 0) tr.delete($from.before(), $from.after());
  const edge = tr.mapping.map(dir > 0 ? $from.after() : $from.before());
  const target = Selection.findFrom(tr.doc.resolve(edge), dir, true);
  return target ? tr.setSelection(target) : null;
}

/** The HTML block next to the caret's textblock, on the side of `dir`, selected. */
function selectHtmlBlock(state: EditorState, dir: 1 | -1): Transaction | null {
  const { $from } = state.selection;
  const index = $from.index(-1) + dir;
  const parent = $from.node(-1);
  if (index < 0 || index >= parent.childCount) return null;
  const block = parent.child(index);
  if (!isHtmlBlock(block)) return null;
  const tr = state.tr;
  if ($from.parent.content.size === 0) tr.delete($from.before(), $from.after());
  const pos =
    dir > 0 ? tr.mapping.map($from.after()) : $from.before() - block.nodeSize;
  return tr.setSelection(selectHtmlBlockAt(tr.doc, pos));
}

export function backspaceAtBlockStart(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parentOffset !== 0) return null;
  return (
    headingToParagraph(state) ??
    liftFirstItem(state) ??
    liftOutOfQuote(state) ??
    stopAtCode(state) ??
    intoTable(state, -1) ??
    selectHtmlBlock(state, -1)
  );
}

/** Where a forward join would pull from: the start of the next textblock. */
function startOfTextblockAfter(state: EditorState) {
  const { $from } = state.selection;
  let cut = -1;
  for (let d = $from.depth - 1; d >= 0; d -= 1) {
    if ($from.index(d) + 1 < $from.node(d).childCount) {
      cut = $from.after(d + 1);
      break;
    }
    if ($from.node(d).type.spec.isolating) return null;
  }
  if (cut < 0) return null;
  let node = state.doc.resolve(cut).nodeAfter;
  let start = cut + 1;
  while (node && !node.isTextblock) {
    if (node.type.spec.isolating) return null;
    node = node.firstChild;
    start += 1;
  }
  return node ? { node, start } : null;
}

/** A rule or an image right after the caret's textblock, selected. */
function selectAtomAfter(state: EditorState): Transaction | null {
  const { $from } = state.selection;
  // From an empty line Milkdown removes the line and selects what follows.
  if ($from.parent.content.size === 0) return null;
  const index = $from.index(-1) + 1;
  const parent = $from.node(-1);
  if (index >= parent.childCount) return null;
  const next = parent.child(index);
  if (!next.isAtom || !next.isBlock || !NodeSelection.isSelectable(next)) {
    return null;
  }
  return state.tr.setSelection(NodeSelection.create(state.doc, $from.after()));
}

export function deleteAtBlockEnd(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const { parent } = $from;
  if (!parent.isTextblock || $from.parentOffset !== parent.content.size) {
    return null;
  }
  const after = startOfTextblockAfter(state);
  if (!after?.node.type.spec.code) {
    return (
      selectAtomAfter(state) ?? intoTable(state, 1) ?? selectHtmlBlock(state, 1)
    );
  }
  const tr = state.tr;
  if (parent.content.size === 0 && $from.node(-1).childCount > 1) {
    tr.delete($from.before(), $from.after());
  }
  return tr.setSelection(
    TextSelection.create(tr.doc, tr.mapping.map(after.start))
  );
}

/**
 * A selected rule, image or HTML block taken, the caret on the side of
 * `bias`: Delete keeps it on the line before, Backspace moves on to the line
 * after, as ProseMirror has it. An HTML block goes with its paragraph, which
 * stayed behind as an empty line.
 */
export function deleteSelectedAtom(
  state: EditorState,
  bias: 1 | -1 = -1
): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const { node, $from } = selection;
  const html = isHtmlBlockSelected(selection);
  if (!html && !(node.isAtom && node.isBlock)) return null;
  const from = html ? $from.before() : selection.from;
  const tr = state.tr.delete(from, html ? $from.after() : selection.to);
  const $at = tr.doc.resolve(tr.mapping.map(from));
  return tr.setSelection(Selection.near($at, bias));
}

export const blockEdges = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/block-edges'),
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.altKey || event.isComposing) return false;
          const tr =
            event.key === 'Backspace'
              ? (backspaceAtBlockStart(view.state) ??
                deleteSelectedAtom(view.state, 1))
              : event.key === 'Delete'
                ? (deleteAtBlockEnd(view.state) ??
                  deleteSelectedAtom(view.state))
                : null;
          if (!tr) return false;
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    })
);

/** `editor.config` hook: frees the two keys from Milkdown's heading keymap. */
export function freeHeadingEdges(ctx: Ctx) {
  ctx.update(headingKeymap.key, (keys) => ({
    ...keys,
    DowngradeHeading: { shortcuts: [] },
  }));
}
