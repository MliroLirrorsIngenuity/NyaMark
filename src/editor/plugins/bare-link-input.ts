/**
 * An address typed into a line becomes a link on the space or Enter after
 * it: `https://…`, `www.…` or an email address, as GFM reads one in a file.
 * It stayed text, and the file had it as GFM does not: `https://…` was
 * saved as `https\://…` to keep it text, and `www.…` and an email address
 * were saved as typed and opened again as links.
 *
 * The link starts and ends where GFM has it, short of the punctuation that
 * closes a sentence, so it is saved bare and reads back as the same link
 * (see bare-links). It also ends at punctuation like Chinese's, where GFM
 * would run on into the sentence after it, and is saved in angle brackets
 * there. Inside a code span still being typed, the address stays text for
 * the code. Backspace right after the space turns it back into the text
 * typed, as it does after the other shortcuts.
 */

import { remarkCtx } from '@milkdown/kit/core';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { type Parse, bareLinksIn } from './bare-links';

type Found = { from: number; to: number; href: string };

// Punctuation other than ASCII's, where a sentence goes on after a link.
const WIDE_PUNCTUATION = /(?=\P{ASCII})\p{P}/u;

/** The first link `parse` reads bare in `text`. */
function firstBareLink(text: string, parse: Parse): Found | null {
  const [link] = bareLinksIn(parse(text), text);
  const from = link?.position?.start?.offset;
  const to = link?.position?.end?.offset;
  if (from === undefined || to === undefined) return null;
  return { from, to, href: link.url ?? '' };
}

/**
 * The address GFM reads in `word`, a run of text with no space or `<`, as
 * offsets into it and the address it links to; null when there is none.
 */
export function bareLinkIn(word: string, parse: Parse): Found | null {
  const found = firstBareLink(word, parse);
  if (!found) return null;
  const wide = word.slice(found.from, found.to).search(WIDE_PUNCTUATION);
  if (wide < 0) return found;
  const cut = firstBareLink(word.slice(0, found.from + wide), parse);
  return cut?.from === found.from ? cut : null;
}

/** The address that ends the text before `at`, as the link to put on it. */
function linkBefore(state: EditorState, at: number, parse: Parse) {
  const $at = state.doc.resolve(at);
  const line = $at.parent;
  const type = state.schema.marks.link;
  if (!type || !line.isTextblock || line.type.spec.code) return null;
  const before = line.textBetween(0, $at.parentOffset, undefined, '\ufffc');
  const word = before.match(/[^\s<]+$/)?.[0];
  if (!word) return null;
  const found = bareLinkIn(word, parse);
  if (!found) return null;
  const start = at - word.length;
  // After a backtick still open: the text of a code span being typed.
  const lead = before.slice(0, before.length - word.length + found.from);
  if ((lead.match(/`/g)?.length ?? 0) % 2 === 1) return null;
  const from = start + found.from;
  const to = start + found.to;
  if (state.doc.rangeHasMark(from, to, type)) return null;
  let code = false;
  state.doc.nodesBetween(from, to, (node) => {
    code ||= node.marks.some((mark) => mark.type.spec.code);
  });
  if (code) return null;
  const mark = type.create({ href: found.href, title: null, bare: true });
  return { from, to, mark };
}

/** The space after an address: typed, and the address made a link. */
export function typedSpaceAfterLink(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number,
  parse: Parse
): Transaction | null {
  const [last = '', space = ''] = [...match[0]];
  // Where the space goes, after the letter that ends the address.
  const at = start + 1;
  if (state.doc.textBetween(start, at, undefined, '\ufffc') !== last) {
    return null;
  }
  const link = linkBefore(state, at, parse);
  if (!link) return null;
  // The space first, so it takes the marks of the text and not the link's.
  return state.tr
    .insertText(space, at, end)
    .addMark(link.from, link.to, link.mark);
}

export const bareLinkInput = $prose((ctx) => {
  const parse: Parse = (markdown) => ctx.get(remarkCtx).parse(markdown);
  const plugin = inputRules({
    rules: [
      new InputRule(
        /[^\s<]\s$/,
        (state, match, start, end) =>
          typedSpaceAfterLink(state, match, start, end, parse),
        { inCodeMark: false }
      ),
    ],
  });
  // Enter ends the address as the space does, ahead of every Enter that
  // splits the line, the list's among them.
  plugin.props.handleDOMEvents = {
    ...plugin.props.handleDOMEvents,
    keydown(view, event) {
      if (event.key !== 'Enter' || event.isComposing || view.composing) {
        return false;
      }
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
        return false;
      }
      const { selection } = view.state;
      const link =
        selection.empty && linkBefore(view.state, selection.head, parse);
      if (link) {
        view.dispatch(view.state.tr.addMark(link.from, link.to, link.mark));
      }
      return false;
    },
  };
  return plugin;
});
