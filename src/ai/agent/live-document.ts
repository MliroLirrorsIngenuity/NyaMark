import type { NyaEditor } from '../../editor/editor';
import { sourceOffset } from '../../editor/source-caret';
import type { DocumentSnapshot } from './document-text';

/**
 * Reads the open document for the assistant: its Markdown as the editor
 * would save it, and the selection as offsets into that text. The source
 * pane's edits are pushed into the editor first, and its selection is the
 * one read (`sourceSelection`, null outside source mode).
 */
export function liveDocument(
  editor: NyaEditor,
  sourceSelection: () => { from: number; to: number } | null
): () => Promise<DocumentSnapshot> {
  return async () => {
    // A long document opens in parts; the assistant reads all of it.
    await editor.whenReady();
    const inSource = sourceSelection();
    const text = editor.getMarkdown();
    const view = editor.getView();
    if (!view) return { text, selection: null };
    const { from, to } = inSource ?? view.state.selection;
    if (from === to) return { text, selection: null };
    const spans = editor.blockSpans(text);
    const { doc } = view.state;
    // As when entering source mode: the text the selection covers, none of
    // the markup around it.
    const start = sourceOffset(doc, from, text, spans, 1);
    const end = Math.max(start, sourceOffset(doc, to, text, spans, -1));
    return { text, selection: start < end ? { from: start, to: end } : null };
  };
}
