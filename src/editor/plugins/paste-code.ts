/**
 * Code pasted from a code block, here or in an editor such as VS Code, stays
 * code. It came as plain text and was read as Markdown: the lines ran into one
 * paragraph without their indents, a `# comment` was escaped or made a
 * heading, and `__init__` went bold. From VS Code the lines came as HTML, each
 * a paragraph of its own, indents dropped or saved as `&#x20;`.
 *
 * Lines of code pasted into a line of text go in as a code block in the
 * language they were copied from, the caret at their end; on an empty line
 * the block takes the line's place. A piece of one line goes into the text as
 * it reads. Where no code block can go, as in a table cell, the paste is left
 * as it was.
 */

import { EditorView as CodeMirror } from '@codemirror/view';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { codeBlockPos } from './code-fence-exit';

/** The code last copied or cut from a code block, and its language. */
let copied: { text: string; language: string } | null = null;

/** What CodeMirror puts on the clipboard: the selection, or the caret's lines. */
function copiedText(cm: CodeMirror): string {
  const { state } = cm;
  const parts = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to));
  if (parts.length) return parts.join(state.lineBreak);
  const lines = new Set(
    state.selection.ranges.map((range) => state.doc.lineAt(range.from).text)
  );
  return [...lines].join(state.lineBreak);
}

/** Notes the code a code block copies, for a paste to know it by. */
export function rememberCodeCopy(getView: () => EditorView | null) {
  const remember = (_event: Event, cm: CodeMirror) => {
    const view = getView();
    const pos = view && codeBlockPos(view, cm.dom);
    const block = pos == null ? null : view?.state.doc.nodeAt(pos);
    copied = {
      text: copiedText(cm),
      language: String(block?.attrs.language ?? ''),
    };
    return false;
  };
  return CodeMirror.domEventHandlers({ copy: remember, cut: remember });
}

/** HTML a code editor puts on the clipboard: lines in a box that keeps spaces. */
const EDITOR_HTML = /<div[^>]*style="[^"]*white-space:\s*pre[;"]/i;

/**
 * The language of code being pasted, '' when not known, or null when the
 * clipboard holds no code.
 */
export function pastedLanguage(text: string, html: string): string | null {
  if (copied && copied.text === text) return copied.language;
  if (EDITOR_HTML.test(html) && /monospace/i.test(html)) return '';
  return null;
}

/** The paste of `text`, code in `language`, at the selection. */
export function pasteCode(
  state: EditorState,
  text: string,
  language: string
): Transaction | null {
  const { selection, schema } = state;
  const { $from } = selection;
  const line = $from.parent;
  if (!line.isTextblock || line.type.spec.code) return null;
  const code = text.replace(/\n$/, '');
  if (!code) return null;
  if (!code.includes('\n')) return state.tr.insertText(code);
  const type = schema.nodes.code_block;
  if (!type) return null;
  const depth = $from.depth - 1;
  const index = $from.index(depth);
  if (!$from.node(depth).canReplaceWith(index, index + 1, type)) return null;
  const block = type.create({ language }, schema.text(code));
  const tr = state.tr;
  let at: number;
  if (selection.empty && line.content.size === 0) {
    at = $from.before();
    tr.replaceWith(at, $from.after(), block);
  } else {
    tr.replaceSelectionWith(block, false);
    const from = tr.mapping.map(selection.from, -1) - 1;
    const to = tr.mapping.map(selection.to, 1) + 1;
    at = -1;
    tr.doc.nodesBetween(Math.max(from, 0), to, (node, pos) => {
      if (at >= 0) return false;
      if (node.type === type && node.textContent === code) at = pos;
      return at < 0 && !node.isTextblock;
    });
    if (at < 0) return null;
  }
  return tr.setSelection(TextSelection.create(tr.doc, at + 1 + code.length));
}

export const pasteCodeAsCode = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/paste-code'),
      props: {
        handleDOMEvents: {
          paste(view, event) {
            const data = event.clipboardData;
            if (!data || view.state.selection.$from.parent.type.spec.code) {
              return false;
            }
            const text = data.getData('text/plain').replace(/\r\n?/g, '\n');
            const language = pastedLanguage(text, data.getData('text/html'));
            if (language == null) return false;
            const tr = pasteCode(view.state, text, language);
            if (!tr) return false;
            event.preventDefault();
            view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'paste'));
            return true;
          },
        },
      },
    })
);
