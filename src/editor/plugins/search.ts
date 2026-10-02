/**
 * Find-in-document over the ProseMirror model. Matches are found per
 * textblock (a match never spans two paragraphs) and painted as inline
 * decorations, so they stay visible while focus sits in the search field
 * and the editor's own selection is not drawn.
 *
 * Code blocks are searched too. CodeMirror renders them and ignores
 * ProseMirror decorations, so they are handed their matches to mark
 * themselves (`code-search.ts`).
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { ensureStyle } from '../../style/register';
import { showCodeMatches } from './code-search';
import { alertMarkers } from './gfm-alerts';

export type SearchMatch = { from: number; to: number };

export type SearchState = {
  query: string;
  matches: SearchMatch[];
  /** Index into `matches`, or -1 when none is current. */
  active: number;
  decorations: DecorationSet;
};

/** Transaction meta that replaces the search state wholesale. */
export type SearchMeta = Pick<SearchState, 'query' | 'matches' | 'active'>;

export const searchKey = new PluginKey<SearchState>('nyamark/search');

const searchStyles = `
.ny-search-match {
  border-radius: 2px;
  background: color-mix(in srgb, var(--ny-warning) 28%, transparent);
}

.ny-search-match--active {
  background: color-mix(in srgb, var(--ny-warning) 60%, transparent);
  box-shadow: 0 0 0 1px var(--ny-warning);
}
`;

const OBJECT_REPLACEMENT = '￼';

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive, literal matches of `query` in document order. An alert's
 * `[!NOTE]` is hidden behind its label: a match there showed nothing, and
 * typing after Escape went into the marker and broke the alert.
 */
export function findMatches(doc: ProseNode, query: string): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  const hidden = alertMarkers(doc);
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Inline atoms (images, hard breaks) become placeholder characters of
    // the same size, so a string index plus the block's content start is a
    // document position.
    let text = '';
    for (let index = 0; index < node.childCount; index++) {
      const child = node.child(index);
      text += child.isText
        ? child.text
        : OBJECT_REPLACEMENT.repeat(child.nodeSize);
    }
    const start = pos + 1;
    for (const hit of text.matchAll(pattern)) {
      const from = start + hit.index;
      const to = from + hit[0].length;
      if (hidden.some((marker) => from < marker.to && to > marker.from)) {
        continue;
      }
      matches.push({ from, to });
    }
    return false;
  });
  return matches;
}

function buildDecorations(
  doc: ProseNode,
  matches: SearchMatch[],
  active: number
) {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === active
            ? 'ny-search-match ny-search-match--active'
            : 'ny-search-match',
      })
    )
  );
}

function createState(doc: ProseNode, meta: SearchMeta): SearchState {
  return {
    ...meta,
    decorations: buildDecorations(doc, meta.matches, meta.active),
  };
}

const emptyState: SearchState = {
  query: '',
  matches: [],
  active: -1,
  decorations: DecorationSet.empty,
};

export function createSearchPlugin() {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => emptyState,
      apply(tr, previous, _oldState, newState) {
        const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
        if (meta) return createState(newState.doc, meta);
        if (!tr.docChanged || !previous.query) return previous;
        // The document changed under an open search: find again and keep
        // the current match at (or just after) where the old one went.
        const matches = findMatches(newState.doc, previous.query);
        const anchor = previous.matches[previous.active];
        let active = -1;
        if (anchor && matches.length > 0) {
          const mapped = tr.mapping.map(anchor.from);
          active = matches.findIndex((match) => match.from >= mapped);
          if (active === -1) active = matches.length - 1;
        }
        return createState(newState.doc, {
          query: previous.query,
          matches,
          active,
        });
      },
    },
    props: {
      decorations: (state) => searchKey.getState(state)?.decorations,
    },
    view: () => ({
      update(view, previous) {
        const search = searchKey.getState(view.state);
        if (!search || search === searchKey.getState(previous)) return;
        showCodeMatches(view, search.matches, search.active);
      },
    }),
  });
}

export const searchPlugin = $prose(() => {
  ensureStyle('search-matches', searchStyles);
  return createSearchPlugin();
});
