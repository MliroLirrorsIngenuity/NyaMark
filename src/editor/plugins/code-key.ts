/**
 * Cmd+E at the caret starts code for what is typed next, and in code ends it,
 * as the toolbar's code button does. Over a selection the preset's own key
 * makes the text code; at the caret it did nothing, where Cmd+B and Cmd+I
 * start bold and italic.
 */

import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const codeKey = $prose((ctx) => {
  const code = inlineCodeSchema.type(ctx);
  return keymap({
    'Mod-e': (state, dispatch) => {
      const { selection } = state;
      if (!(selection instanceof TextSelection) || !selection.$cursor) {
        return false;
      }
      const { $cursor } = selection;
      if (!$cursor.parent.inlineContent || $cursor.parent.type.spec.code) {
        return false;
      }
      const inCode = code.isInSet(state.storedMarks ?? $cursor.marks());
      dispatch?.(
        inCode
          ? state.tr.removeStoredMark(code)
          : state.tr.addStoredMark(code.create())
      );
      return true;
    },
  });
});
