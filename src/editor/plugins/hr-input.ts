/**
 * `---` typed on a line of its own becomes a rule, and the caret goes on to
 * the line below it.
 *
 * It stands in for Milkdown's own rule, which left the new rule selected as
 * a node, so the next letter typed replaced it: `---` and then a word gave
 * the word with no rule above it. This one puts the caret on the line after
 * the rule in the same step, so Backspace still turns it back into the
 * dashes typed.
 *
 * In a list item, whose first line has to stay text, Milkdown's rule put the
 * rule under that line and left it as an empty bullet, saved as `<br />`. The
 * rule goes under the item above, as code typed there does.
 *
 * A line that reads as a rule, `***` or `___`, becomes one on Enter, as in
 * Typora. Typed, each waits for a space, as they open a bold or italic word
 * too, and with Enter they stayed text, saved escaped, `\*\*\*`.
 */

import { remarkCtx } from '@milkdown/kit/core';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Fragment } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { replaceLineWith } from './fence-input';
import { caretBelowTypedBlock } from './typed-block-enter';
import type { Parse } from './typed-blocks';

/** Three dashes, or three underscores or stars and a space. */
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

/** The caret's line, when it reads as a rule, made one with a line under it. */
export function ruleFromLine(
  state: EditorState,
  parse: Parse
): Transaction | null {
  const hr = state.schema.nodes.hr;
  const { selection } = state;
  if (!hr || !(selection instanceof TextSelection)) return null;
  const $head = selection.$cursor;
  const line = $head?.parent;
  if (!$head || line?.type.name !== 'paragraph') return null;
  if ($head.parentOffset !== line.content.size) return null;
  const text = (line.childCount === 1 && line.firstChild?.text) || '';
  const [block, ...rest] = parse(text).children;
  if (block?.type !== 'thematicBreak' || rest.length) return null;
  const placed = replaceLineWith(
    state,
    Fragment.from([hr.create(), line.type.create()])
  );
  if (!placed) return null;
  const { tr, at } = placed;
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

export const ruleOnEnter = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('nyamark/rule-on-enter'),
      props: {
        // Ahead of every plugin's handleKeyDown, the list's Enter among them.
        handleDOMEvents: {
          keydown(view, event) {
            if (event.key !== 'Enter' || event.isComposing || view.composing) {
              return false;
            }
            if (event.shiftKey || event.altKey || event.metaKey) return false;
            if (event.ctrlKey) return false;
            const tr = ruleFromLine(view.state, (markdown) =>
              ctx.get(remarkCtx).parse(markdown)
            );
            if (!tr) return false;
            view.dispatch(tr.scrollIntoView());
            event.preventDefault();
            return true;
          },
        },
      },
    })
);
