/**
 * A table pasted on an empty line takes the line's place, as a list, a quote
 * or a picture pasted there does. ProseMirror put the table under the line
 * and left the line empty above it, to be deleted by hand -- a table copied
 * in the document, pasted as Markdown or from a web page alike.
 *
 * Any block that a paste puts right under the empty line it started on takes
 * the line, so long as the container holds without it.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const pasteOnEmptyLine = $prose(() => {
  /** Where the empty line the paste began on starts, while one goes on. */
  let line = -1;
  return new Plugin({
    key: new PluginKey('nyamark/paste-line'),
    props: {
      handleDOMEvents: {
        paste(view) {
          const { selection } = view.state;
          const { $from } = selection;
          const empty =
            selection.empty &&
            $from.parent.type.name === 'paragraph' &&
            $from.parent.content.size === 0;
          line = empty ? $from.before() : -1;
          // The paste itself is handled within this event.
          queueMicrotask(() => {
            line = -1;
          });
          return false;
        },
      },
    },
    appendTransaction(trs, before, state) {
      if (line < 0 || !trs.some((tr) => tr.docChanged)) return null;
      const start = line;
      line = -1;
      const at = trs.reduce((pos, tr) => tr.mapping.map(pos, -1), start);
      const node = state.doc.nodeAt(at);
      if (node?.type.name !== 'paragraph' || node.content.size) return null;
      const $at = state.doc.resolve(at);
      const below = state.doc.resolve(at + node.nodeSize).nodeAfter;
      if (!below || below.isTextblock) return null;
      // A block that was there already, under a paste that went elsewhere.
      if (below === before.doc.resolve(start + node.nodeSize).nodeAfter) {
        return null;
      }
      const index = $at.index();
      if (!$at.parent.canReplace(index, index + 1)) return null;
      return state.tr.delete(at, at + node.nodeSize);
    },
  });
});
