/**
 * `---` typed on a line of its own becomes a rule, and the caret goes on to
 * the line below it.
 *
 * Milkdown's own rule for it left the new rule selected as a node, so the
 * next letter typed replaced it: `---` and then a word gave the word with no
 * rule above it. This one runs first, for a paragraph, and puts the caret on
 * the line after the rule in the same step, so Backspace still turns it back
 * into the dashes typed. Anywhere else Milkdown's rule has it as before.
 *
 * In a list item, whose first line has to stay text, Milkdown's rule put the
 * rule under that line and left it as an empty bullet, saved as `<br />`. The
 * rule goes under the item above, as code typed there does.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Fragment } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { replaceLineWith } from './fence-input';
import { caretBelowTypedBlock } from './typed-block-enter';

/** Milkdown's own pattern: three dashes, or three underscores or stars and a space. */
const RULE = /^(?:---|___\s|\*\*\*\s)$/;

export const hrInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(RULE, (state, _match, start, end) => {
        const hr = state.schema.nodes.hr;
        const $start = state.doc.resolve(start);
        if (!hr || $start.parent.type.name !== 'paragraph') return null;
        // The line goes on below the rule with whatever followed the dashes,
        // so there is one to type on at the end of the document too.
        const line = $start.parent;
        const rest = line.copy(line.content.cut(end - $start.start()));
        const placed = replaceLineWith(
          state,
          Fragment.from([hr.create(), rest])
        );
        if (!placed) return null;
        const { tr, at } = placed;
        if (!rest.content.size) caretBelowTypedBlock(tr, at + 2);
        return tr
          .setSelection(TextSelection.create(tr.doc, at + 2))
          .scrollIntoView();
      }),
    ],
  })
);
