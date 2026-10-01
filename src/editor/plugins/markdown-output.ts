/**
 * Keeps the markdown NyaMark writes close to what the user wrote. Runs on the
 * mdast tree right before it is stringified; parsing is left alone.
 *
 * Lists: Milkdown 7.20 parses a list's `spread` flag into a string ("false"),
 * and mdast-util-to-markdown only honours a boolean there, so every saved list
 * came back loose -- a blank line between items and before each nested list.
 * An item typed in the editor starts out with `spread: true`, which did the
 * same to every nested list the user typed. The flags are turned back into
 * booleans, and a typed item only stays loose inside a loose list.
 *
 * Alerts: the `[!NOTE]` marker that opens a GFM alert was escaped to
 * `\[!NOTE]`, which GitHub then shows as plain text. It is written verbatim,
 * and a hard break typed after it becomes a plain line break: GitHub does not
 * accept `[!NOTE]\` as a marker line.
 *
 * Trailing empty paragraphs: the editor keeps an empty paragraph after a
 * closing quote, list or code block so the caret has somewhere to go, and
 * leaving a quote with Enter adds another. They were saved as a blank line or
 * a `<br />` at the end of the file. Empty lines at the very end carry nothing
 * in markdown, so they are dropped.
 *
 * Leading spaces: Enter just before a space splits "一 二" into "一" and " 二",
 * and markdown drops the space at the start of a paragraph or heading, so it
 * was written as `&#x20;二` to survive. It is left out instead, the way it
 * would read when the file is opened again.
 */

import { $remark } from '@milkdown/kit/utils';
import type { Processor } from 'unified';

type MdNode = {
  type: string;
  value?: string;
  spread?: unknown;
  children?: MdNode[];
};

const ALERT_MARKER = /^\[!(?:note|tip|important|warning|caution)\]/i;
const LINE_BREAK = /^<br\s*\/?>$/i;

function normalizeList(list: MdNode) {
  const loose = list.spread === true || list.spread === 'true';
  list.spread = loose;
  for (const item of list.children ?? []) {
    // A parsed item carries the string; a boolean `true` is the schema
    // default of an item typed in the editor.
    item.spread = item.spread === 'true' || (item.spread === true && loose);
  }
}

function unescapeAlertMarker(blockquote: MdNode) {
  const paragraph = blockquote.children?.[0];
  if (paragraph?.type !== 'paragraph') return;
  const text = paragraph.children?.[0];
  if (text?.type !== 'text' || !text.value) return;
  const marker = text.value.match(ALERT_MARKER)?.[0];
  if (!marker || !paragraph.children) return;
  // An html node is written out as is, so the brackets stay unescaped.
  const rest = text.value.slice(marker.length);
  const hardBreak = !rest && paragraph.children[1]?.type === 'break';
  paragraph.children.splice(
    0,
    hardBreak ? 2 : 1,
    { type: 'html', value: hardBreak ? `${marker}\n` : marker },
    ...(rest ? [{ type: 'text', value: rest }] : [])
  );
}

function trimLeadingSpace(block: MdNode) {
  const first = block.children?.[0];
  if (first?.type !== 'text' || !first.value) return;
  first.value = first.value.replace(/^[ \t]+/, '');
}

/** Empty, or holding only the `<br />` Milkdown writes for an empty line. */
function isEmptyParagraph(node: MdNode) {
  return (
    node.type === 'paragraph' &&
    (node.children ?? []).every(
      (child) =>
        (child.type === 'text' && !child.value) ||
        (child.type === 'html' && LINE_BREAK.test(child.value?.trim() ?? ''))
    )
  );
}

export function normalizeForOutput<T extends MdNode>(tree: T): T {
  const visit = (node: MdNode) => {
    if (node.type === 'list') normalizeList(node);
    if (node.type === 'blockquote') unescapeAlertMarker(node);
    if (node.type === 'paragraph' || node.type === 'heading') {
      trimLeadingSpace(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  // After the trim: a last line of nothing but spaces is empty too.
  const blocks = tree.children;
  while (blocks?.length && isEmptyParagraph(blocks[blocks.length - 1])) {
    blocks.pop();
  }
  return tree;
}

/** Unified plugin: runs `normalizeForOutput` on every tree it stringifies. */
export function normalizeOutput(this: Processor) {
  const compile = this.compiler;
  if (!compile) return;
  this.compiler = (tree, file) =>
    compile(normalizeForOutput(tree as MdNode) as typeof tree, file);
}

export const markdownOutput = $remark(
  'nyamark-markdown-output',
  () => normalizeOutput
);
