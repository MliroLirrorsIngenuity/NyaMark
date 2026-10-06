/**
 * Carries the caret across the switch between the editor and the source pane.
 * Entering source mode put the caret at the top of the file, and leaving it
 * dropped it altogether.
 *
 * The editor reads markdown block for block: each top-level node of the
 * markdown tree becomes one top-level block of the document, and its position
 * says where the block sits in the text (`BlockSpan`). Inside a block, each
 * character of text is where the markdown tokenizer read it, in the tokens
 * the tree's text nodes were made from, and the document's text is matched
 * to those characters in order.
 */

import type { Node } from '@milkdown/kit/prose/model';
import { type Options, parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { matchPairs } from './myers';

type MdNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

type Located = { chars: string[]; at: number[]; end: number[] };

export type BlockSpan = { from: number; to: number; text?: () => Located };

export interface MarkdownReader {
  parse(markdown: string): unknown;
  runSync(tree: never, file?: string): unknown;
  data(): { micromarkExtensions?: unknown[] };
}

const TEXT = [
  'data',
  'characterEscape',
  'characterReference',
  'lineEnding',
  'autolinkProtocol',
  'autolinkEmail',
  'literalAutolinkEmail',
  'literalAutolinkHttp',
  'literalAutolinkWww',
];
const VALUES: Record<string, readonly string[]> = {
  text: TEXT,
  inlineCode: ['codeTextData', 'lineEnding'],
  code: ['codeFlowValue', 'lineEnding'],
  math: ['mathFlowValue', 'lineEnding'],
  yaml: ['yamlValue', 'lineEnding'],
  toml: ['tomlValue', 'lineEnding'],
};
const READ = new Set(Object.values(VALUES).flat());
const FLOW = new Set(['code', 'math', 'yaml', 'toml']);
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'tableCell', ...FLOW]);
const DECODED = new Set(['characterEscape', 'characterReference']);
const BOUNDARY = '';
const MAX_COST = 2000;

type Unit = [at: number, end: number, char: string];
type Step = { leaf: boolean; type: string; from: number; to: number };

const leafText = (node: Node) => (node.type.name === 'hardbreak' ? '\n' : '');

function outline(tree: MdNode) {
  const steps: Step[] = [];
  const visit = (node: MdNode, inside: boolean) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from == null || to == null) return;
    const textblock = TEXTBLOCKS.has(node.type);
    if (!inside && (textblock || node.children?.length === 0)) {
      steps.push({ leaf: false, type: node.type, from, to });
    }
    if (node.type in VALUES || node.type === 'break') {
      steps.push({ leaf: true, type: node.type, from, to });
    }
    for (const child of node.children ?? []) visit(child, inside || textblock);
  };
  for (const child of tree.children ?? []) visit(child, false);
  return steps;
}

function lastAtOrBefore<T>(
  items: readonly T[],
  offset: number,
  of: (item: T) => number
) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (of(items[mid]) <= offset) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function lineStart(markdown: string, offset: number) {
  let start = offset;
  while (
    start > 0 &&
    markdown[start - 1] !== '\n' &&
    markdown[start - 1] !== '\r'
  ) {
    start--;
  }
  return start;
}

function locate(
  markdown: string,
  steps: Step[],
  from: number,
  to: number,
  extensions: Options['extensions']
): Located {
  const mine = steps.slice(
    lastAtOrBefore(steps, from - 1, (step) => step.from) + 1,
    lastAtOrBefore(steps, to, (step) => step.from) + 1
  );
  const leaves = mine.filter((step) => step.leaf);
  const units = leaves.map((leaf): Unit[] =>
    leaf.type === 'break' ? [[leaf.to - 1, leaf.to, '\n']] : []
  );
  const open: Array<number | undefined> = [];
  const leafAt = (offset: number, type: string) => {
    const index = lastAtOrBefore(leaves, offset, (leaf) => leaf.from);
    const leaf = leaves[index];
    return leaf && offset < leaf.to && VALUES[leaf.type]?.includes(type)
      ? index
      : -1;
  };

  const base = lineStart(markdown, from);
  const events = postprocess(
    parse({ extensions })
      .document()
      .write(preprocess()(markdown.slice(base, to), undefined, true))
  );
  const spaces: number[] = [];
  for (const [kind, token] of events) {
    if (kind !== 'enter') continue;
    const start = base + token.start.offset;
    const end = base + token.end.offset;
    if (token.type === 'whitespace') {
      spaces.push(end);
      continue;
    }
    if (!READ.has(token.type)) continue;
    if (token.type !== 'lineEnding' && !DECODED.has(token.type)) {
      for (let i = start; i < end; i++) {
        units[leafAt(i, token.type)]?.push([i, i + 1, markdown[i]]);
      }
      continue;
    }
    const index = leafAt(start, token.type);
    if (index < 0 || end > leaves[index].to) continue;
    if (token.type === 'lineEnding') {
      units[index].push([start, end, '\n']);
      continue;
    }
    const decoded = decodeString(markdown.slice(start, end));
    for (let i = 0; i < decoded.length; i++) {
      units[index].push([start, end, decoded[i]]);
    }
  }
  spaces.sort((a, b) => a - b);
  leaves.forEach((leaf, index) => {
    const own = units[index];
    own.sort((a, b) => a[0] - b[0]);
    if (!FLOW.has(leaf.type)) return;
    if (own[0]?.[2] === '\n') open[index] = own.shift()?.[1];
    if (own[own.length - 1]?.[2] === '\n') own.pop();
  });

  const located: Located = { chars: [], at: [], end: [] };
  const push = (char: string, at: number, end: number) => {
    located.chars.push(char);
    located.at.push(at);
    located.end.push(end);
  };
  let leaf = 0;
  mine.forEach((step, index) => {
    if (step.leaf) {
      for (const [at, end, char] of units[leaf]) push(char, at, end);
      leaf++;
      return;
    }
    let slot = -1;
    for (let i = index + 1, next = leaf; i < mine.length && slot < 0; i++) {
      if (!mine[i].leaf) continue;
      if (mine[i].from >= step.to) break;
      slot = units[next][0]?.[0] ?? open[next] ?? -1;
      next++;
    }
    if (slot < 0) {
      const space = spaces[lastAtOrBefore(spaces, step.to, (each) => each)];
      slot = space != null && space > step.from ? space : step.to;
    }
    push(BOUNDARY, slot, slot);
  });
  return located;
}

/** The span of each top-level node of `markdown` as `reader` reads it. */
export function sourceSpans(
  reader: MarkdownReader,
  markdown: string
): BlockSpan[] {
  const tree = reader.parse(markdown) as MdNode;
  const steps = outline(tree);
  const extensions = reader.data().micromarkExtensions as Options['extensions'];
  const done = reader.runSync(tree as never, markdown) as MdNode;
  let last = 0;
  return (done.children ?? []).map((node) => {
    const from = node.position?.start.offset ?? last;
    const to = node.position?.end.offset ?? from;
    last = to;
    let located: Located | null = null;
    const text = () => {
      located ??= locate(markdown, steps, from, to, extensions);
      return located;
    };
    return { from, to, text };
  });
}

function childPos(doc: Node, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** A paragraph, heading or cell of a block, as found in the markdown. */
type Placed = {
  /** Position of its content in the document. */
  start: number;
  node: Node;
  text: string;
  /** Where each character of `text` starts in the markdown, -1 if it is not. */
  at: number[];
  end: number[];
  /** Where its text starts in the markdown, or would when it is empty. */
  first: number;
  /** Just after its last character found in the markdown. */
  last: number;
};

/** Every textblock of the top-level block at `index`, found in its span. */
function place(doc: Node, index: number, span: BlockSpan): Placed[] {
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

  const ours: string[] = [];
  const owner: Array<[entry: number, char: number]> = [];
  const texts = found.map(({ node }, entry) => {
    const text = node.textBetween(0, node.content.size, '', leafText);
    ours.push(BOUNDARY);
    owner.push([entry, -1]);
    for (let i = 0; i < text.length; i++) {
      ours.push(text[i]);
      owner.push([entry, i]);
    }
    return text;
  });

  const located = span.text?.();
  const lo = located
    ? lastAtOrBefore(located.at, span.from - 1, (at) => at) + 1
    : 0;
  const hi = located ? lastAtOrBefore(located.at, span.to, (at) => at) + 1 : 0;
  const theirs = located ? located.chars.slice(lo, hi) : [];
  const pairs = matchPairs(ours, theirs, (x, y) => x === y, MAX_COST) ?? [];

  const placed = found.map(({ start, node }, entry) => ({
    start,
    node,
    text: texts[entry],
    at: new Array<number>(texts[entry].length).fill(-1),
    end: new Array<number>(texts[entry].length).fill(-1),
    first: -1,
    last: -1,
  }));
  for (const [mine, other] of pairs) {
    const [entry, char] = owner[mine];
    const at = located?.at[lo + other] ?? -1;
    const end = located?.end[lo + other] ?? -1;
    if (char < 0) placed[entry].first = at;
    else {
      placed[entry].at[char] = at;
      placed[entry].end[char] = end;
    }
  }
  let previous = span.from;
  for (const entry of placed) {
    const matched = entry.at.findIndex((at) => at >= 0);
    if (entry.first < 0)
      entry.first = matched >= 0 ? entry.at[matched] : previous;
    entry.last = entry.first;
    for (let i = entry.end.length - 1; i >= 0; i--) {
      if (entry.end[i] >= 0) {
        entry.last = entry.end[i];
        break;
      }
    }
    previous = entry.last;
  }
  return placed;
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
  const placed = place(doc, index, span);
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
    if (entry.end[i] >= 0) return entry.end[i];
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
  const placed = place(doc, index, spans[index]);
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
