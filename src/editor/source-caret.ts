/**
 * Carries the caret across the switch between the editor and the source pane.
 * Entering source mode put the caret at the top of the file, and leaving it
 * dropped it altogether.
 *
 * The editor reads markdown block for block: each top-level node of the
 * markdown tree becomes one top-level block of the document, and its position
 * says where the block sits in the text (`BlockSpan`). Inside a block, the
 * text of each paragraph, heading or table cell is found in the markdown one
 * character after another, stepping over the markup around it: `#`, `**`,
 * `- [ ]`, `|`, a link's url. A character the markdown spells differently (an
 * entity, a space it leaves out) is passed over.
 */

import type { Node } from '@milkdown/kit/prose/model';

export type BlockSpan = { from: number; to: number };

type MdNode = {
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

/** A paragraph, heading or cell of a block, as found in the markdown. */
type Placed = {
  /** Position of its content in the document. */
  start: number;
  node: Node;
  text: string;
  /** Where each character of `text` is in the markdown, -1 if it is not. */
  at: number[];
  /** Where its text starts in the markdown, or would when it is empty. */
  first: number;
  /** Just after its last character found in the markdown. */
  last: number;
};

// The markup that opens a line before its text: quote and list markers, a
// task box, a heading's hashes. A code block's text starts after its fence.
const LEAD =
  /\s*(?:>[ \t]*)*(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[[ xX]\](?:[ \t]+|$))?|#{1,6}(?:[ \t]+|$))?/my;
const FENCE =
  /\s*(?:>[ \t]*)*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(?:`{3,}|~{3,}|\$\$)[^\n]*\n/y;

const leafText = (node: Node) => (node.type.name === 'hardbreak' ? '\n' : '');

/** The span of each top-level node of a parsed markdown tree. */
export function blockSpans(root: MdNode): BlockSpan[] {
  let last = 0;
  return (root.children ?? []).map((node) => {
    const from = node.position?.start.offset ?? last;
    const to = node.position?.end.offset ?? from;
    last = to;
    return { from, to };
  });
}

function childPos(doc: Node, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** Skips the markup before a textblock's text that its text could match. */
function skipLead(part: string, next: number, node: Node) {
  const lead = node.type.spec.code ? FENCE : LEAD;
  lead.lastIndex = next;
  return lead.exec(part) ? lead.lastIndex : next;
}

/** Every textblock of the top-level block at `index`, found in its span. */
function place(
  doc: Node,
  index: number,
  source: string,
  span: BlockSpan
): Placed[] {
  const block = doc.child(index);
  const pos = childPos(doc, index);
  const found: Array<{ start: number; node: Node }> = [];
  if (block.isTextblock) found.push({ start: pos + 1, node: block });
  else {
    block.descendants((node, offset) => {
      if (!node.isTextblock) return true;
      found.push({ start: pos + 1 + offset + 1, node });
      return false;
    });
  }

  const part = source.slice(span.from, span.to);
  let next = 0;
  return found.map(({ start, node }) => {
    next = skipLead(part, next, node);
    const from = span.from + next;
    const text = node.textBetween(0, node.content.size, '', leafText);
    const at: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const hit = part.indexOf(text[i], next);
      if (hit < 0) {
        at.push(-1);
        continue;
      }
      at.push(span.from + hit);
      next = hit + 1;
    }
    const matched = at.filter((offset) => offset >= 0);
    const first = matched.length ? matched[0] : from;
    const last = matched.length ? matched[matched.length - 1] + 1 : first;
    return { start, node, text, at, first, last };
  });
}

/** Document position of the `count`th character of a textblock's text. */
function positionAt({ start, node }: Placed, count: number) {
  let left = count;
  let pos = start;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const size = child.isText
      ? (child.text?.length ?? 0)
      : leafText(child).length;
    if (left <= size) {
      if (child.isText) return pos + left;
      return left > 0 ? pos + child.nodeSize : pos;
    }
    left -= size;
    pos += child.nodeSize;
  }
  return pos;
}

/**
 * Offset in `source` for position `pos` of `doc`, the document it reads as.
 * Where markup stands at the position, `side` picks the end of the text
 * before it (-1, where typing carries on that text) or the start of the text
 * after it (1, where a selection starts).
 */
export function sourceOffset(
  doc: Node,
  pos: number,
  source: string,
  spans: BlockSpan[],
  side: -1 | 1 = -1
): number {
  const $pos = doc.resolve(pos);
  const index = $pos.index(0);
  const span = spans[index];
  // The empty paragraph the editor keeps at the end is not in the markdown.
  if (index >= doc.childCount || !span) return source.length;
  const placed = place(doc, index, source, span);
  const entry = $pos.parent.isTextblock
    ? placed.find((candidate) => candidate.start === $pos.start())
    : undefined;
  if (!entry) return span.from;
  const count = $pos.parent.textBetween(
    0,
    $pos.parentOffset,
    '',
    leafText
  ).length;
  if (side > 0 && entry.at[count] >= 0) return entry.at[count];
  for (let i = count - 1; i >= 0; i--) {
    if (entry.at[i] >= 0) return entry.at[i] + 1;
  }
  return entry.first;
}

/** Position in `doc` for offset `offset` of `source`, the markdown it was read from. */
export function docPosition(
  doc: Node,
  offset: number,
  source: string,
  spans: BlockSpan[]
): number {
  const blocks = Math.min(spans.length, doc.childCount);
  let index = spans.findIndex((span) => offset <= span.to);
  // Past the last block: the end of its text.
  if (index < 0 || index >= blocks) index = blocks - 1;
  if (index < 0) return 0;
  const placed = place(doc, index, source, spans[index]);
  if (!placed.length) return childPos(doc, index);

  for (let j = 0; j < placed.length; j++) {
    const entry = placed[j];
    if (offset < entry.first) {
      // Before this text: on its line the caret goes to its start, on an
      // earlier line to the end of the text before it.
      const previous = placed[j - 1];
      if (previous && source.slice(offset, entry.first).includes('\n')) {
        return positionAt(previous, previous.text.length);
      }
      return positionAt(entry, 0);
    }
    if (offset <= entry.last) {
      const count = entry.at.findIndex((at) => at >= offset);
      return positionAt(entry, count < 0 ? entry.text.length : count);
    }
  }
  const end = placed[placed.length - 1];
  return positionAt(end, end.text.length);
}
