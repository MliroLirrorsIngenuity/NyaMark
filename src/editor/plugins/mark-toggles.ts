/**
 * Bold, italic, strikethrough and inline code, from the format bar or their
 * keys, go on all of the text selected unless all of it has them already, as
 * in other editors, and their buttons light only then. A word in bold in the
 * line selected lit the bold button, and Cmd+B took the bold off that word
 * where the whole line was to be made bold; with everything selected every
 * button lit.
 *
 * A link's button still lights for a link anywhere in the selection: it takes
 * the link off, wherever it is.
 */

import { commandsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  emphasisSchema,
  inlineCodeSchema,
  isMarkSelectedCommand,
  linkSchema,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  strikethroughSchema,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { toggleMark } from '@milkdown/kit/prose/commands';
import type { MarkType } from '@milkdown/kit/prose/model';
import type { Command, EditorState } from '@milkdown/kit/prose/state';

/**
 * Whether all of the selection has `type`: each piece of it that could, past
 * runs of nothing but space. The marks typing takes, at a caret.
 */
export function markedThroughout(state: EditorState, type: MarkType): boolean {
  const { selection, doc } = state;
  if (selection.empty) {
    return !!type.isInSet(state.storedMarks ?? selection.$from.marks());
  }
  let found = false;
  let missing = false;
  for (const { $from, $to } of selection.ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (missing) return false;
      if (!node.isInline || !parent?.type.allowsMarkType(type)) return true;
      if (node.isText) {
        const start = Math.max(0, $from.pos - pos);
        const text = node.text?.slice(start, $to.pos - pos) ?? '';
        if (!text.trim()) return false;
      }
      if (type.isInSet(node.marks)) found = true;
      else missing = true;
      return false;
    });
  }
  return found && !missing;
}

/** `type` on all of the selection, or off it where all of it has it. */
export function toggleThroughout(type: MarkType): Command {
  return (state, dispatch) =>
    markedThroughout(state, type)
      ? toggleMark(type)(state, dispatch)
      : toggleMark(type, null, { removeWhenPresent: false })(state, dispatch);
}

/**
 * Inline code on all of the selection in place of its other marks, or off
 * it where all of it is code. Nothing at a caret.
 */
export function toggleCodeThroughout(type: MarkType): Command {
  return (state, dispatch) => {
    const { selection, schema } = state;
    if (selection.empty) return false;
    const { from, to } = selection;
    const { tr } = state;
    if (markedThroughout(state, type)) {
      dispatch?.(tr.removeMark(from, to, type));
      return true;
    }
    for (const other of Object.values(schema.marks)) {
      if (other !== type) tr.removeMark(from, to, other);
    }
    dispatch?.(tr.addMark(from, to, type.create()));
    return true;
  };
}

/** Puts these in place of the preset's, once the editor is made. */
export function markTogglesThroughout(ctx: Ctx) {
  const commands = ctx.get(commandsCtx);
  const link = linkSchema.type(ctx);
  commands.create(toggleStrongCommand.key, () =>
    toggleThroughout(strongSchema.type(ctx))
  );
  commands.create(toggleEmphasisCommand.key, () =>
    toggleThroughout(emphasisSchema.type(ctx))
  );
  commands.create(toggleStrikethroughCommand.key, () =>
    toggleThroughout(strikethroughSchema.type(ctx))
  );
  commands.create(toggleInlineCodeCommand.key, () =>
    toggleCodeThroughout(inlineCodeSchema.type(ctx))
  );
  commands.create(
    isMarkSelectedCommand.key,
    (type?: MarkType) => (state: EditorState) => {
      if (!type) return false;
      if (type !== link) return markedThroughout(state, type);
      const { from, to } = state.selection;
      return state.doc.rangeHasMark(from, to, type);
    }
  );
}
