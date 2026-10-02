/**
 * Shift+Enter in a heading starts a new line as Enter does. It broke the
 * heading over two lines, which Markdown can only write underlined with
 * `===`, and the `#` heading was saved so.
 *
 * A heading of the third level or below holds one line: Markdown writes it
 * on the line of its hashes, and only the first two levels underlined over
 * more. A paragraph written over two lines and made such a heading, from the
 * keys, the top bar or `### ` typed in front of it, was saved with its second
 * line out of it, a paragraph of its own once the file was opened again. Its
 * line breaks go as they were drawn: one between two Chinese characters as
 * nothing, any other as a space.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { joinedBreakAt } from './cjk-breaks';

export const headingShiftEnter = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/heading-break'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || !event.shiftKey || event.isComposing)
            return false;
          if (event.altKey || event.metaKey || event.ctrlKey) return false;
          if (view.state.selection.$from.parent.type.name !== 'heading')
            return false;
          const enter = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          });
          // ProseMirror's keymaps read the key code too.
          Object.defineProperty(enter, 'keyCode', { value: 13 });
          view.someProp('handleKeyDown', (handle) => handle(view, enter));
          return true;
        },
      },
    })
);

/** The line breaks of the headings below the second level, taken out. */
export function oneLineHeadings(state: EditorState): Transaction | null {
  const { hardbreak } = state.schema.nodes;
  const breaks: number[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === 'heading' && node.attrs.level >= 3) {
      node.forEach((child, offset) => {
        if (child.type === hardbreak) breaks.push(pos + 1 + offset);
      });
    }
    return false;
  });
  if (breaks.length === 0) return null;
  const { tr } = state;
  // From the last, so the places of the others stand.
  for (const at of breaks.reverse()) {
    const before = tr.doc.resolve(at).nodeBefore;
    const after = tr.doc.resolve(at + 1).nodeAfter;
    const spaced =
      !before?.isText ||
      !after?.isText ||
      /\s$/.test(before.text ?? '') ||
      /^\s/.test(after.text ?? '');
    if (spaced || joinedBreakAt(tr.doc, at)) tr.delete(at, at + 1);
    else tr.replaceWith(at, at + 1, state.schema.text(' ', before.marks));
  }
  return tr;
}

export const headingOneLine = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/heading-one-line'),
      appendTransaction: (trs, _old, state) =>
        trs.some((tr) => tr.docChanged) ? oneLineHeadings(state) : null,
    })
);
