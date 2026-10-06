/**
 * Release notes as the update dialog shows them. They are the Markdown
 * git-cliff writes, and in a <pre> the dialog showed "### 🐛 Bug Fixes" and
 * "- *(editor)* Rank the …  @someone" to the letter. Its groups become
 * headings and its changes a list, the scope leading each change. The version
 * line, which the cards above give already, and the author after each change
 * are left out. Built from text nodes alone: the notes come off the network.
 */

import type { ListItem, Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as words } from 'mdast-util-to-string';

export type ReleaseNoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; scope: string | null; text: string }
  | { kind: 'text'; text: string };

/** Emphasis, code and links read as their words, run together as on a page. */
function plain(nodes: Nodes | Nodes[]) {
  return words(nodes, { includeHtml: false }).replace(/\s+/g, ' ').trim();
}

// The authors git-cliff writes after a change: GitHub user names, which are
// letters, digits and hyphens, an app's ending in `[bot]`.
const AUTHORS = /(?:\s+@[\w-]+(?:\[bot\])?)+$/;

/** A change: the `*(scope)*` it opens with, and its words. */
function change(item: ListItem) {
  const [first, ...rest] = item.children;
  const inline = first?.type === 'paragraph' ? [...first.children] : [];
  const lead = inline[0]?.type === 'emphasis' ? plain(inline[0]) : '';
  const scoped = lead.startsWith('(') && lead.endsWith(')');
  if (scoped) inline.shift();
  const blocks = first?.type === 'paragraph' ? rest : item.children;
  const text = [plain(inline), ...blocks.map((block) => plain(block))]
    .filter(Boolean)
    .join(' ')
    .replace(AUTHORS, '');
  return { scope: scoped ? lead.slice(1, -1) : null, text };
}

export function releaseNoteBlocks(markdown: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  for (const node of fromMarkdown(markdown).children) {
    if (node.type === 'list') {
      for (const item of node.children) {
        const next = change(item);
        if (next.text || next.scope) blocks.push({ kind: 'item', ...next });
      }
      continue;
    }
    // git-cliff writes the version as a heading over its groups', which the
    // cards above give already.
    if (node.type === 'heading' && node.depth <= 2) continue;
    const text = plain(node);
    const kind = node.type === 'heading' ? 'heading' : 'text';
    if (text) blocks.push({ kind, text });
  }
  return blocks;
}

/** Fills `container` with the notes; false when they hold nothing to show. */
export function renderReleaseNotes(container: HTMLElement, markdown: string) {
  const blocks = releaseNoteBlocks(markdown);
  let list: HTMLUListElement | null = null;
  for (const block of blocks) {
    if (block.kind !== 'item') {
      list = null;
      const element = document.createElement(
        block.kind === 'heading' ? 'h5' : 'p'
      );
      element.textContent = block.text;
      container.appendChild(element);
      continue;
    }
    if (!list) {
      list = document.createElement('ul');
      container.appendChild(list);
    }
    const entry = document.createElement('li');
    if (block.scope) {
      const scope = document.createElement('span');
      scope.className = 'ny-release-notes__scope';
      scope.textContent = block.scope;
      entry.append(scope, ' ');
    }
    entry.append(block.text);
    list.appendChild(entry);
  }
  return blocks.length > 0;
}
