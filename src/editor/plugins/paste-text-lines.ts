/**
 * Lines of plain text pasted stay lines, a paragraph each, as Enter makes
 * them when they are typed. The text is read as Markdown, where a line break
 * inside a paragraph reads as a space: three lines copied from a text file or
 * a chat came in as one, run together with spaces between.
 *
 * Markdown in the text still reads as Markdown: a list, a quote, a table or a
 * fence keeps its lines. Only the line breaks of a paragraph at the top of
 * what was pasted break it into paragraphs.
 */

import { parserCtx } from '@milkdown/kit/core';
import { Fragment, type Node, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** A line break that Markdown reads as a space. */
const softBreak = (node: Node) =>
  node.type.name === 'hardbreak' && node.attrs.isInline === true;

/**
 * `doc`'s blocks, each paragraph broken at its soft line breaks, or null
 * when none has one.
 */
export function splitSoftLines(doc: Node): Fragment | null {
  const blocks: Node[] = [];
  let split = false;
  for (let i = 0; i < doc.childCount; i++) {
    const block = doc.child(i);
    if (block.type.name !== 'paragraph') {
      blocks.push(block);
      continue;
    }
    let line: Node[] = [];
    for (let j = 0; j < block.childCount; j++) {
      const child = block.child(j);
      if (!softBreak(child)) {
        line.push(child);
        continue;
      }
      blocks.push(block.copy(Fragment.from(line)));
      line = [];
      split = true;
    }
    blocks.push(block.copy(Fragment.from(line)));
  }
  return split ? Fragment.from(blocks) : null;
}

export const pasteTextLines = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('nyamark/paste-text-lines'),
      props: {
        handleDOMEvents: {
          paste(view, event) {
            const data = event.clipboardData;
            if (!data || data.getData('text/html')) return false;
            if (data.types.includes('vscode-editor-data')) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
            if (!text.includes('\n')) return false;
            const doc = ctx.get(parserCtx)(text);
            if (!doc || typeof doc === 'string') return false;
            const lines = splitSoftLines(doc);
            if (!lines) return false;
            event.preventDefault();
            const tr = view.state.tr.replaceSelection(Slice.maxOpen(lines));
            view.dispatch(
              tr
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
