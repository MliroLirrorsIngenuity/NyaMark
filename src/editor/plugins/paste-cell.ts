/**
 * What is pasted into a table cell goes in as one line, which is what a cell
 * holds. Two paragraphs pasted into one broke the table: the row ended at the
 * caret, the second paragraph went in under it, and the rest of the table
 * went on below that as a table of its own; a web page's paragraphs added
 * columns. A line break pasted in was saved inside the row and cut it in two
 * when the file was read back.
 *
 * The text of each block pasted now goes in after the last, a space between
 * them, and its line breaks as spaces; a code block's goes in as inline code.
 * A table pasted into a cell still fills the cells from it.
 */

import { parserCtx } from '@milkdown/kit/core';
import {
  Fragment,
  type Node,
  type Schema,
  Slice,
} from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const CELL_TYPES = new Set(['table_cell', 'table_header']);

/** Whether the selection in `state` is within the line of one table cell. */
export function inCell(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return (
    $from.depth > 0 &&
    $from.sameParent($to) &&
    CELL_TYPES.has($from.node(-1).type.name)
  );
}

/**
 * `content` as one line of inline content, or null when it is that already
 * or holds a table.
 */
export function oneLine(content: Fragment, schema: Schema): Fragment | null {
  const inline: Node[] = [];
  let lines = 0;
  let breaks = false;
  let table = false;
  content.descendants((node) => {
    if (table) return false;
    if (node.type.name === 'table') {
      table = true;
      return false;
    }
    if (!node.isTextblock) return true;
    if (lines++ > 0) inline.push(schema.text(' '));
    const code = schema.marks.inlineCode;
    if (node.type.spec.code && code && node.textContent) {
      // A code block's lines, as code.
      const text = node.textContent.replace(/\n+/g, ' ');
      inline.push(schema.text(text, [code.create()]));
      breaks = true;
      return false;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type.name === 'hardbreak') {
        inline.push(schema.text(' ', child.marks));
        breaks = true;
      } else if (child.text?.includes('\n')) {
        inline.push(schema.text(child.text.replace(/\n+/g, ' '), child.marks));
        breaks = true;
      } else {
        inline.push(child);
      }
    }
    return false;
  });
  if (table || (lines < 2 && !breaks)) return null;
  return Fragment.from(inline);
}

/** `content` as one line for a cell, or null when it goes in as it is. */
function forCell(content: Fragment, schema: Schema): Slice | null {
  const line = oneLine(content, schema);
  const paragraph = schema.nodes.paragraph;
  if (!line || !paragraph) return null;
  return new Slice(Fragment.from(paragraph.create(null, line)), 1, 1);
}

export const pasteIntoCell = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('nyamark/paste-cell'),
      props: {
        // A paste from a web page, or from the document itself.
        transformPasted(slice, view) {
          if (!inCell(view.state)) return slice;
          return forCell(slice.content, view.state.schema) ?? slice;
        },
        handleDOMEvents: {
          // Plain text, which Milkdown reads as Markdown on its own.
          paste(view, event) {
            const data = event.clipboardData;
            if (!data || data.getData('text/html') || !inCell(view.state)) {
              return false;
            }
            const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
            if (!text.includes('\n')) return false;
            const doc = ctx.get(parserCtx)(text);
            if (!doc || typeof doc === 'string') return false;
            const slice = forCell(doc.content, view.state.schema);
            if (!slice) return false;
            event.preventDefault();
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta('paste', true)
                .setMeta('uiEvent', 'paste')
            );
            return true;
          },
        },
      },
    })
);
