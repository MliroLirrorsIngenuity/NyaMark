/**
 * Plain text pasted is read as Markdown, and two things in it came in wrong.
 *
 * Lines of plain text stay lines, a paragraph each, as Enter makes them when
 * they are typed. A line break inside a Markdown paragraph reads as a space:
 * three lines copied from a text file or a chat came in as one, run together
 * with spaces between. Only the line breaks of a paragraph at the top of what
 * was pasted break it; a list, a quote or a table keeps its lines, and a line
 * in a table cell, which holds one, takes the text as before.
 *
 * A heading, a list, a fence or another block that the text begins with
 * stays that block when it is pasted into a line of text at the top of the
 * document. Its first line went into the line as text: `## 标题` pasted after
 * a word gave the word and `标题`, and a list's first item ran on from it.
 * The line now ends at the caret and the block goes in below it; pasted at
 * the start of the line, the blocks go in above it.
 */

import { parserCtx } from '@milkdown/kit/core';
import {
  Fragment,
  type Node,
  type NodeType,
  Slice,
} from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  Selection,
  type Transaction,
} from '@milkdown/kit/prose/state';
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

/**
 * The paste of `doc`, read from plain text, at the selection in `state`, or
 * null where the paste Milkdown makes of it is the one wanted.
 */
export function pasteText(state: EditorState, doc: Node): Transaction | null {
  const { selection } = state;
  const { $from } = selection;
  const line = $from.parent;
  const first = doc.firstChild;
  if (!first || !line.isTextblock || line.type.spec.code) return null;
  const container = $from.node(-1);
  const next = $from.indexAfter(-1);
  const holds = (type: NodeType) => container.canReplaceWith(next, next, type);
  const lines = holds(state.schema.nodes.paragraph)
    ? splitSoftLines(doc)
    : null;
  const content = lines ?? doc.content;
  const keepFirst =
    $from.depth === 1 &&
    line.content.size > 0 &&
    first.type.name !== 'paragraph' &&
    holds(first.type);
  if (!lines && !keepFirst) return null;
  const tr = state.tr;
  if (keepFirst && selection.empty && $from.parentOffset === 0) {
    const at = $from.before();
    tr.insert(at, content);
    const end = tr.doc.resolve(at + content.size);
    return tr.setSelection(Selection.near(end, -1));
  }
  const open = Slice.maxOpen(content);
  const start = keepFirst ? 0 : open.openStart;
  return tr.replaceSelection(new Slice(content, start, open.openEnd));
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
            const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
            if (!text.includes('\n')) return false;
            const doc = ctx.get(parserCtx)(text);
            if (!doc || typeof doc === 'string') return false;
            const tr = pasteText(view.state, doc);
            if (!tr) return false;
            event.preventDefault();
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
