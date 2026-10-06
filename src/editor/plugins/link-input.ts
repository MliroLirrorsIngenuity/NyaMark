/**
 * `[text](url)` typed into a line becomes a link once its closing parenthesis
 * is typed, and `![alt](src)` an image. Milkdown has no rule for either: the
 * brackets stayed text and were saved escaped, `\[text]\(url)`.
 *
 * An image typed on a line of its own becomes an image block, the way one
 * opens from a file, with the caret on the line below it; within text it is
 * an inline image. Backspace right after either turns it back into the text
 * typed, as it does after the other shortcuts. Inside a code span still being
 * typed, `` `[a](b)` ``, the brackets stay text for the code.
 */

import { remarkCtx } from '@milkdown/kit/core';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { caretBelowTypedBlock } from './typed-block-enter';

interface Syntax {
  type: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Syntax[];
}

export type Parse = (markdown: string) => Syntax;

const CLOSE = /\)$/;
const HOLE = '\ufffc';

function sourceBefore(state: EditorState, at: number) {
  const $at = state.doc.resolve(at);
  const start = $at.start();
  let raw = '';
  $at.parent.forEach((child, offset) => {
    const size = Math.min(child.nodeSize, at - start - offset);
    if (size <= 0) return;
    const literal =
      child.isText && !child.marks.some((mark) => mark.type.spec.code);
    raw += literal ? (child.text ?? '').slice(0, size) : HOLE.repeat(size);
  });
  return { $at, start, raw };
}

function endingAt(tree: Syntax, end: number): Syntax | null {
  for (const child of tree.children ?? []) {
    const found = endingAt(child, end);
    if (found) return found;
  }
  const kind = tree.type === 'link' || tree.type === 'image';
  return kind && tree.position?.end.offset === end ? tree : null;
}

function sameSyntax(a: Syntax, b: Syntax | null) {
  return (
    b?.type === a.type &&
    b.position?.start.offset === a.position?.start.offset &&
    b.position?.end.offset === a.position?.end.offset
  );
}

function couldBeCode(raw: string, node: Syntax, parse: Parse) {
  const runs = new Set(raw.match(/`+/g));
  return [...runs].some(
    (run) => !sameSyntax(node, endingAt(parse(raw + run), raw.length))
  );
}

function linkOf(
  state: EditorState,
  node: Syntax,
  from: number,
  end: number,
  start: number
): Transaction | null {
  const type = state.schema.marks.link;
  const children = node.children ?? [];
  const textFrom = children[0]?.position?.start.offset;
  const textTo = children[children.length - 1]?.position?.end.offset;
  if (!type || textFrom == null || textTo == null || textFrom >= textTo) {
    return null;
  }
  const href = node.url ?? '';
  const title = node.title ?? null;
  if (href.includes(HOLE) || title?.includes(HOLE)) return null;
  // The brackets go and the text between them takes the link as it stands:
  // made plain text, it lost its bold, and a line break in it was gone with
  // a stray character in its place.
  const length = textTo - textFrom;
  return (
    state.tr
      .delete(start + textTo, end)
      .delete(from, start + textFrom)
      .addMark(from, from + length, type.create({ href, title }))
      // What is typed next goes after the link, outside it.
      .removeStoredMark(type)
  );
}

function imageOf(
  state: EditorState,
  node: Syntax,
  from: number,
  end: number
): Transaction | null {
  const src = node.url ?? '';
  const alt = node.alt ?? '';
  const title = node.title ?? '';
  // A description is text alone.
  if ([src, alt, title].some((value) => value.includes(HOLE))) return null;
  const { nodes } = state.schema;
  const $start = state.doc.resolve(from);
  const line = $start.parent;
  const block = nodes['image-block'];
  const index = $start.index(-1);
  if (
    block &&
    line.type.name === 'paragraph' &&
    from === $start.start() &&
    end === $start.end() &&
    $start.node(-1).canReplaceWith(index, index, block)
  ) {
    const at = $start.before();
    const tr = state.tr.replaceWith(at, $start.after(), [
      block.create({ src, alt, caption: title }),
      line.type.create(),
    ]);
    return caretBelowTypedBlock(tr, at + 2)
      .setSelection(TextSelection.create(tr.doc, at + 2))
      .scrollIntoView();
  }
  const inline = nodes.image;
  if (!inline) return null;
  return state.tr.replaceWith(from, end, inline.create({ src, alt, title }));
}

export function typedLink(
  state: EditorState,
  typed: string,
  at: number,
  end: number,
  parse: Parse
): Transaction | null {
  const { start, raw: before } = sourceBefore(state, at);
  const raw = before + typed;
  const node = endingAt(parse(raw), raw.length);
  const offset = node?.position?.start.offset;
  if (!node || offset == null || couldBeCode(raw, node, parse)) return null;
  const from = start + offset;
  if (node.type === 'image') return imageOf(state, node, from, end);
  if (raw[offset] !== '[') return null;
  return linkOf(state, node, from, end, start);
}

export const linkInput = $prose((ctx) => {
  const parse: Parse = (markdown) => ctx.get(remarkCtx).parse(markdown);
  return inputRules({
    rules: [
      new InputRule(
        CLOSE,
        (state, match, start, end) =>
          typedLink(state, match[0], start, end, parse),
        { inCodeMark: false }
      ),
    ],
  });
});
