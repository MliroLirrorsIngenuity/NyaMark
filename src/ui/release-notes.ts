/**
 * Release notes as the update dialog shows them. They are the Markdown
 * git-cliff writes, and in a <pre> the dialog showed "### 🐛 Bug Fixes" and
 * "- *(editor)* Rank the …  @someone" to the letter. Its groups become
 * headings and its changes a list, the scope leading each change. The version
 * line, which the cards above give already, and the author after each change
 * are left out. Built from text nodes alone: the notes come off the network.
 */

export type ReleaseNoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; scope: string | null; text: string }
  | { kind: 'text'; text: string };

/** Emphasis, code and links read as their words. */
function plain(text: string) {
  return text
    .replace(/<!--.*?-->/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|\*|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A change's text with the scope it opens with and the authors after it. */
function change(text: string) {
  const scoped = /^\*\(([^)]+)\)\*\s*(.*)$/.exec(text.trim());
  const rest = (scoped ? scoped[2] : text).replace(
    /(?:\s+@[\w-]+(?:\[bot\])?)+\s*$/,
    ''
  );
  return { scope: scoped ? plain(scoped[1]) : null, text: plain(rest) };
}

const VERSION_HEADING = /^#{1,2}\s+(?:v?\d+\.\d+|unreleased\b)/i;

export function releaseNoteBlocks(markdown: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  // The change or paragraph a line without a mark of its own goes on.
  let open: Exclude<ReleaseNoteBlock, { kind: 'heading' }> | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      open = null;
      continue;
    }
    if (VERSION_HEADING.test(line)) {
      open = null;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const text = plain(heading[1]);
      if (text) blocks.push({ kind: 'heading', text });
      open = null;
      continue;
    }
    const item = /^[-*+]\s+(.*)$/.exec(line);
    if (item) {
      const next = { kind: 'item' as const, ...change(item[1]) };
      if (!next.text && !next.scope) continue;
      blocks.push(next);
      open = next;
      continue;
    }
    if (open) {
      open.text = `${open.text} ${plain(line)}`.trim();
      continue;
    }
    open = { kind: 'text', text: plain(line) };
    blocks.push(open);
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
