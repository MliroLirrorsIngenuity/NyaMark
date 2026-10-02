/**
 * An address pasted over text makes the text a link to it, as in Typora,
 * Notion and Google Docs. The paste put the address in place of the text,
 * which then had to be typed again and linked by hand.
 *
 * Only an address alone on the clipboard does, over text in one line. Over
 * text that is an address itself, the new address takes its place as before.
 */

import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const ADDRESS = /^(?:https?:\/\/|mailto:)\S+$/i;
const LOOKS_LIKE_ADDRESS = /^(?:[a-z][a-z+.-]*:|www\.)\S*$/i;

/** The address on the clipboard, when it holds an address alone. */
export function pastedAddress(data: DataTransfer | null): string | null {
  if (!data || data.files.length > 0) return null;
  const text = data.getData('text/plain').trim();
  return ADDRESS.test(text) ? text : null;
}

/** The selected text made a link to `href`, or null where it stays a paste. */
export function linkSelection(
  state: EditorState,
  href: string
): Transaction | null {
  const { selection } = state;
  const link = state.schema.marks.link;
  if (!link || !(selection instanceof TextSelection) || selection.empty) {
    return null;
  }
  const { $from, $to, from, to } = selection;
  const line = $from.parent;
  if (!$from.sameParent($to) || !line.inlineContent || line.type.spec.code) {
    return null;
  }
  if (!line.type.allowsMarkType(link)) return null;
  const text = state.doc.textBetween(from, to).trim();
  if (!text || LOOKS_LIKE_ADDRESS.test(text)) return null;
  const tr = state.tr.addMark(from, to, link.create({ href }));
  return tr.setSelection(TextSelection.create(tr.doc, to)).scrollIntoView();
}

export const pasteLinkOverText = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/paste-link'),
      props: {
        handleDOMEvents: {
          // Ahead of the clipboard plugin, which reads the address as text.
          paste(view, event) {
            const href = pastedAddress(event.clipboardData);
            if (!href) return false;
            const tr = linkSelection(view.state, href);
            if (!tr) return false;
            event.preventDefault();
            view.dispatch(
              tr.setMeta('paste', true).setMeta('uiEvent', 'paste')
            );
            return true;
          },
        },
      },
    })
);
