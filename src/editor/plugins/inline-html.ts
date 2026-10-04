/**
 * HTML in running text reaches the document a tag at a time: remark reads
 * `<sup><a href="#ref-1">[1]</a></sup>` as two opening tags, the text `[1]`
 * and two closing tags, and no tag alone can draw the citation it makes.
 *
 * Each opening tag is taken here with what it holds up to its closing tag,
 * and with the tags written right after it, into one piece of HTML in the
 * words of the file. It shows as the HTML it is and is saved back as
 * written. A tag closed in another line, or in another mark, stays alone.
 */

import { $remark } from '@milkdown/kit/utils';

type MdNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

/** Nodes that hold running text, where a tag sits among words. */
const PHRASING_PARENTS = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
]);

const VOID_ELEMENTS = new Set([
  'area',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'source',
  'track',
  'wbr',
]);

type Tag = { kind: 'open' | 'close' | 'other'; name: string };

/** What a node of HTML in running text is: one tag, or a comment. */
function tagOf(node: MdNode): Tag | null {
  if (node.type !== 'html') return null;
  const value = node.value ?? '';
  const close = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>$/.exec(value);
  if (close) return { kind: 'close', name: close[1].toLowerCase() };
  const open = /^<([A-Za-z][A-Za-z0-9-]*)[\s/>]/.exec(value);
  if (!open || !value.endsWith('>')) return { kind: 'other', name: '' };
  const name = open[1].toLowerCase();
  const empty = VOID_ELEMENTS.has(name) || value.endsWith('/>');
  return { kind: empty ? 'other' : 'open', name };
}

/**
 * The index of the last node of the HTML that starts with an opening tag at
 * `start`, or -1. It runs on while a tag is open, and past the point all
 * are closed while tags follow with no text between, as the empty anchor
 * written before a back link does.
 */
function runEnd(children: MdNode[], start: number): number {
  if (tagOf(children[start])?.kind !== 'open') return -1;
  const open: string[] = [];
  let end = -1;
  for (let index = start; index < children.length; index += 1) {
    const tag = tagOf(children[index]);
    if (!tag) {
      if (!open.length) break;
      continue;
    }
    if (tag.kind === 'open') open.push(tag.name);
    if (tag.kind === 'close') {
      const at = open.lastIndexOf(tag.name);
      if (at < 0) break;
      open.length = at;
    }
    if (!open.length) end = index;
  }
  return end;
}

/** Remark transformer: each tag and what it holds made one node of HTML. */
export function joinInlineHtml(tree: MdNode, source: string) {
  const visit = (node: MdNode) => {
    const children = node.children;
    if (!children) return;
    if (PHRASING_PARENTS.has(node.type)) {
      for (let index = 0; index < children.length; index += 1) {
        const end = runEnd(children, index);
        if (end < 0) continue;
        const first = children[index].position?.start;
        const last = children[end].position?.end;
        if (first?.offset === undefined || last?.offset === undefined) continue;
        const value = source.slice(first.offset, last.offset);
        // Over lines, the words of the file hold the quote markers or the
        // list indentation, and written back they were doubled.
        if (/[\r\n]/.test(value)) continue;
        children.splice(index, end - index + 1, {
          type: 'html',
          value,
          position: { start: first, end: last },
        });
      }
    }
    for (const child of children) visit(child);
  };
  visit(tree);
}

export const inlineHtmlRuns = $remark(
  'nyamark-inline-html-runs',
  () => () => (tree, file) => joinInlineHtml(tree as MdNode, String(file.value))
);
