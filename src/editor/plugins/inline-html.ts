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
import { Parser } from 'htmlparser2';

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

/**
 * The index of the last node of the HTML that starts with an opening tag at
 * `start`, or -1. It runs on while an element is open, as an HTML parser
 * reads the tags, and past the point all are closed while tags follow with
 * no text between, as the empty anchor written before a back link does.
 */
function runEnd(children: MdNode[], start: number): number {
  let open = 0;
  const parser = new Parser({
    onopentag: () => {
      open += 1;
    },
    onclosetag: () => {
      open -= 1;
    },
  });
  let end = -1;
  for (let index = start; index < children.length; index += 1) {
    const node = children[index];
    if (node.type !== 'html') {
      if (!open) break;
      continue;
    }
    parser.write(node.value ?? '');
    if (!open && index === start) return -1;
    if (!open) end = index;
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
