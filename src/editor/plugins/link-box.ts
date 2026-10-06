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
 * An address typed as GFM links one in running text, `www.…` or an email
 * address, gets the scheme GFM gives it: the link was opened as a file of
 * that name beside the document, which was not there. Any other address
 * without a scheme, `notes.md` or `example.com`, names a file, as in Markdown.
 */

import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip';
import { editorViewCtx, remarkCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  type SelectionBookmark,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { AddMarkStep } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { toString as plainText } from 'mdast-util-to-string';
import { forInputMethod } from '../../ui/ime';
import { marksAround } from './mark-cursor';
import type { Parse } from './typed-blocks';

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

/** `typed` as the address of a link, with the scheme GFM reads it with. */
export function linkAddress(typed: string, parse: Parse): string {
  const value = typed.trim();
  const [block, ...rest] = parse(value).children;
  const [link, ...more] = block?.type === 'paragraph' ? block.children : [];
  const whole = link?.type === 'link' && !rest.length && !more.length;
  return whole && plainText(link) === value ? link.url : value;
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
    if (event.key !== 'Enter' || forInputMethod(event)) return null;
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
function linkTyped(view: EditorView, event: Event, parse: Parse) {
  const field = confirmed(event);
  const typed = field?.value.trim();
  if (!field || !typed) return;
  const href = linkAddress(typed, parse);
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

/** The selection the box was last opened from, and the text it was in. */
const openedFrom = new WeakMap<
  Ctx,
  { doc: ProseNode; bookmark: SelectionBookmark }
>();

/**
 * Escape in the box puts back the selection it was opened from. To change a
 * link the box selects all of it, and it stayed selected once the box closed:
 * the first key typed took the place of the link.
 */
export function restoreOnCancel(ctx: Ctx) {
  ctx.update(linkTooltipAPI.key, (api) => {
    const remember = () => {
      const { state } = ctx.get(editorViewCtx);
      const bookmark = state.selection.getBookmark();
      openedFrom.set(ctx, { doc: state.doc, bookmark });
    };
    return {
      ...api,
      addLink: (from, to) => {
        remember();
        api.addLink(from, to);
      },
      editLink: (mark, from, to) => {
        remember();
        api.editLink(mark, from, to);
      },
    };
  });
}

function cancelled(ctx: Ctx, view: EditorView, event: Event) {
  if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
  const target = event.target as Element | null;
  if (event.isComposing || !target?.closest?.('.milkdown-link-edit')) return;
  const opened = openedFrom.get(ctx);
  openedFrom.delete(ctx);
  if (!opened || opened.doc !== view.state.doc) return;
  const selection = opened.bookmark.resolve(view.state.doc);
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
}

export const linkBox = $prose(
  (ctx) =>
    new Plugin({
      appendTransaction: (trs, _old, state) => caretAfterLink(trs, state),
      view(view) {
        const doc = view.dom.ownerDocument;
        const listen = (event: Event) => {
          linkTyped(view, event, (markdown) =>
            ctx.get(remarkCtx).parse(markdown)
          );
          cancelled(ctx, view, event);
        };
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
