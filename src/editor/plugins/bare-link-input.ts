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

import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

type Found = { from: number; to: number; href: string };

/** Where each kind of address may start in a word, after what is before. */
const STARTS = [
  { kind: 'protocol', at: /(^|[^A-Za-z])https?:\/\//i },
  { kind: 'www', at: /(^|[(*_[\]~])www\./i },
  { kind: 'email', at: /(^|[^/+\-._A-Za-z0-9])[A-Za-z0-9+\-._]+@/ },
] as const;

// What GFM leaves off the end of an address: `)` only when unmatched.
const TRAIL = /[!"'),*.:;?\]_~]$/;
const ENTITY = /&[A-Za-z]+;$/;
// Punctuation other than ASCII's, where a sentence goes on after a link.
const WIDE_PUNCTUATION = /(?=\P{ASCII})\p{P}/u;
// A domain runs to the first space or punctuation other than `-`, `.`, `_`.
const DOMAIN = /^(?:[^\s\p{P}\p{S}]|[-._])+/u;
const EMAIL =
  /^[A-Za-z0-9+\-._]+@[A-Za-z0-9\-_]+(?:\.[A-Za-z0-9][A-Za-z0-9\-_]*)+/;

function count(text: string, char: string) {
  return text.split(char).length - 1;
}

function trimTrail(link: string): string {
  let rest = link;
  for (;;) {
    const entity = rest.match(ENTITY);
    if (entity) {
      rest = rest.slice(0, -entity[0].length);
      continue;
    }
    if (!TRAIL.test(rest)) return rest;
    if (rest.endsWith(')') && count(rest, '(') >= count(rest, ')')) {
      return rest;
    }
    rest = rest.slice(0, -1);
  }
}

/** Whether `domain` is one GFM links: no `_` in its last two parts. */
function linksDomain(domain: string) {
  if (!/[^._]/.test(domain)) return false;
  return !domain.split('.').slice(-2).join('.').includes('_');
}

/**
 * The address GFM reads in `word`, a run of text with no space or `<`, as
 * offsets into it and the address it links to; null when there is none.
 */
export function bareLinkIn(word: string): Found | null {
  let found: { kind: string; from: number } | null = null;
  for (const { kind, at } of STARTS) {
    const match = word.match(at);
    if (!match || match.index === undefined) continue;
    const from = match.index + (match[1]?.length ?? 0);
    if (!found || from < found.from) found = { kind, from };
  }
  if (!found) return null;
  const { kind, from } = found;
  const rest = word.slice(from);
  if (kind === 'email') {
    const email = rest.match(EMAIL)?.[0];
    if (!email || !/[A-Za-z]$/.test(email)) return null;
    return { from, to: from + email.length, href: `mailto:${email}` };
  }
  const wide = rest.search(WIDE_PUNCTUATION);
  const link = trimTrail(wide < 0 ? rest : rest.slice(0, wide));
  const prefix = kind === 'www' ? 4 : link.indexOf('//') + 2;
  const domain = link.slice(prefix).match(DOMAIN)?.[0] ?? '';
  if (!linksDomain(domain.replace(/[._]+$/, ''))) return null;
  const href = kind === 'www' ? `http://${link}` : link;
  return { from, to: from + link.length, href };
}

/** The address that ends the text before `at`, as the link to put on it. */
function linkBefore(state: EditorState, at: number) {
  const $at = state.doc.resolve(at);
  const line = $at.parent;
  const type = state.schema.marks.link;
  if (!type || !line.isTextblock || line.type.spec.code) return null;
  const before = line.textBetween(0, $at.parentOffset, undefined, '\ufffc');
  const word = before.match(/[^\s<]+$/)?.[0];
  if (!word) return null;
  const found = bareLinkIn(word);
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
  end: number
): Transaction | null {
  const [last = '', space = ''] = [...match[0]];
  // Where the space goes, after the letter that ends the address.
  const at = start + 1;
  if (state.doc.textBetween(start, at, undefined, '\ufffc') !== last) {
    return null;
  }
  const link = linkBefore(state, at);
  if (!link) return null;
  // The space first, so it takes the marks of the text and not the link's.
  return state.tr
    .insertText(space, at, end)
    .addMark(link.from, link.to, link.mark);
}

export const bareLinkInput = $prose(() => {
  const plugin = inputRules({
    rules: [
      new InputRule(/[^\s<]\s$/, typedSpaceAfterLink, { inCodeMark: false }),
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
      const link = selection.empty && linkBefore(view.state, selection.head);
      if (link) {
        view.dispatch(view.state.tr.addMark(link.from, link.to, link.mark));
      }
      return false;
    },
  };
  return plugin;
});
