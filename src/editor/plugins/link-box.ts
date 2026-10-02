/**
 * The box a link's address is typed in, from the toolbar or a link's own
 * tooltip.
 *
 * A link put on the selected text leaves the caret just after it, outside the
 * link, as a click past its end does. The text stayed selected once the box
 * closed, and the first key typed took its place, the link going with it.
 *
 * With nothing selected, the address goes in at the caret as the text of its
 * link. It went nowhere: the box put the link on the empty selection, closed,
 * and the address typed was lost.
 *
 * A website typed without its `https://`, as `example.com` or `www.…`, gets
 * one, and an email address its `mailto:`. The link was opened as a file of
 * that name beside the document, which was not there.
 */

import {
  type EditorState,
  Plugin,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { AddMarkStep } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { marksAround } from './mark-cursor';

/** The caret after the link `trs` put on all of the selection, if they did. */
export function caretAfterLink(
  trs: readonly Transaction[],
  state: EditorState
): Transaction | null {
  const { selection } = state;
  const link = state.schema.marks.link;
  if (!link || !(selection instanceof TextSelection)) return null;
  if (selection.empty) return null;
  const linked = trs.some((tr) =>
    tr.steps.some(
      (step) =>
        step instanceof AddMarkStep &&
        step.mark.type === link &&
        step.from === selection.from &&
        step.to === selection.to
    )
  );
  if (!linked) return null;
  const at = TextSelection.create(state.doc, selection.to);
  return state.tr.setSelection(at).setStoredMarks(marksAround(at.$head)[1]);
}

// Endings of a name that is a website's rather than a file's.
const WEB_ENDING =
  /\.(com|net|org|edu|gov|io|dev|ai|co|me|moe|info|xyz|top|site|tech|cn|jp|uk|de|fr|tv|us)$/i;

/** `typed` as the address of a link, with the scheme it was typed without. */
export function linkAddress(typed: string): string {
  const value = typed.trim();
  if (/^[^\s@/:]+@[^\s@/]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`;
  const host = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)/i.exec(
    value
  );
  if (host && (/^www\./i.test(host[1]) || WEB_ENDING.test(host[1]))) {
    return `https://${value}`;
  }
  return value;
}

/**
 * `href` put in at the caret as a link reading `text`, the caret after it.
 */
export function linkAtCaret(
  state: EditorState,
  href: string,
  text = href
): Transaction | null {
  const { selection } = state;
  const link = state.schema.marks.link;
  if (!link || !href || !(selection instanceof TextSelection)) return null;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.inlineContent) return null;
  if ($from.parent.type.spec.code) return null;
  const typed = link.removeFromSet(state.storedMarks ?? $from.marks());
  const marks = link.create({ href }).addToSet(typed);
  const tr = state.tr.insert($from.pos, state.schema.text(text, marks));
  const at = TextSelection.create(tr.doc, $from.pos + text.length);
  return tr.setSelection(at).setStoredMarks(typed);
}

/** The link box's field, when `event` confirms it: Enter, or a press on its button. */
function confirmed(event: Event): HTMLInputElement | null {
  const target = event.target as Element | null;
  const box = target?.closest?.('.milkdown-link-edit');
  if (!box) return null;
  if (event instanceof KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return null;
  } else if (!target?.closest('.confirm')) {
    return null;
  }
  return box.querySelector('input');
}

/**
 * Ahead of the box's own handlers: those put the link on the selection, with
 * the address the field holds as it is changed here. The caret moving off the
 * place the box was opened at closes it.
 */
function linkTyped(view: EditorView, event: Event) {
  const field = confirmed(event);
  const typed = field?.value.trim();
  if (!field || !typed) return;
  const href = linkAddress(typed);
  if (href !== field.value) {
    field.value = href;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const tr = linkAtCaret(view.state, href, typed);
  if (!tr) return;
  event.preventDefault();
  event.stopPropagation();
  view.dispatch(tr.scrollIntoView());
}

export const linkBox = $prose(
  () =>
    new Plugin({
      appendTransaction: (trs, _old, state) => caretAfterLink(trs, state),
      view(view) {
        const doc = view.dom.ownerDocument;
        const listen = (event: Event) => linkTyped(view, event);
        doc.addEventListener('keydown', listen, true);
        doc.addEventListener('pointerdown', listen, true);
        return {
          destroy() {
            doc.removeEventListener('keydown', listen, true);
            doc.removeEventListener('pointerdown', listen, true);
          },
        };
      },
    })
);
