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
 * Elsewhere a line typed in Markdown takes effect on Enter, as a fence, `$$`
 * or a table's first row does, so Enter followed the dashes out of habit and
 * left an empty line under the rule, saved as `<br />`. An Enter that comes
 * straight after the rule, with the caret where the rule put it, is taken as
 * that one.
 */

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** Milkdown's own pattern: three dashes, or three underscores or stars and a space. */
const RULE = /^(?:---|___\s|\*\*\*\s)$/;

/** Where a rule just typed put the caret, until anything else happens. */
const lineUnderRule = new PluginKey<number | null>('nyamark/hr-enter');

export const hrInput = $prose(() =>
  inputRules({
    rules: [
      new InputRule(RULE, (state, _match, start, end) => {
        const hr = state.schema.nodes.hr;
        const $start = state.doc.resolve(start);
        if (!hr || $start.parent.type.name !== 'paragraph') return null;
        const index = $start.index(-1);
        if (!$start.node(-1).canReplaceWith(index, index, hr)) return null;
        // The line goes on below the rule with whatever followed the dashes,
        // so there is one to type on at the end of the document too.
        const line = $start.parent;
        const rest = line.copy(line.content.cut(end - $start.start()));
        const at = $start.before();
        const tr = state.tr.replaceWith(at, $start.after(), [
          hr.create(),
          rest,
        ]);
        return tr
          .setSelection(TextSelection.create(tr.doc, at + 2))
          .setMeta(lineUnderRule, at + 2)
          .scrollIntoView();
      }),
    ],
  })
);

export const enterAfterRule = $prose(
  () =>
    new Plugin<number | null>({
      key: lineUnderRule,
      state: {
        init: () => null,
        apply(tr, at) {
          const meta = tr.getMeta(lineUnderRule) as number | null | undefined;
          if (meta !== undefined) return meta;
          return tr.docChanged || tr.selectionSet ? null : at;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || event.isComposing) return false;
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
            return false;
          const at = lineUnderRule.getState(view.state);
          const { selection } = view.state;
          if (at == null || !selection.empty || selection.head !== at)
            return false;
          view.dispatch(view.state.tr.setMeta(lineUnderRule, null));
          return true;
        },
      },
    })
);
