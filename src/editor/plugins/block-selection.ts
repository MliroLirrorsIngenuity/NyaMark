/**
 * Makes a selection that spans a node view read as one continuous ribbon.
 *
 * Paragraphs paint themselves: the browser's native selection covers their
 * text (and, like every native text view on macOS, fills the gaps between
 * them). Node views do not. A code block renders its own opaque card with
 * CodeMirror inside, and CodeMirror only tints the text runs on each line --
 * so a drag from the paragraph above to the paragraph below left a lighter,
 * differently-shaped hole punched through the middle of the band. That is the
 * "选中会变成这种非常不自然的状态" report.
 *
 * The missing piece is knowledge CSS does not have: whether the current
 * TextSelection *fully covers* a given block. Only fully covered blocks get
 * washed -- a block the selection merely reaches into is already painting its
 * own partial range, and washing it whole would claim more than is selected.
 *
 * Implemented as a plugin view that toggles a class straight on the node
 * view's DOM rather than as a ProseMirror node decoration: decoration changes
 * are handed to the node view's `update()`, and a node view that declines
 * them gets torn down and rebuilt -- which for a code block means destroying
 * and recreating the whole CodeMirror instance on every selection change.
 */

import type { EditorState } from '@milkdown/kit/prose/state';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const pluginKey = new PluginKey('nyamark/block-selection');

/** Toggled on the node view DOM of every fully-selected top-level block. */
const COVERED_CLASS = 'ny-block-selected';

/**
 * Only blocks that render their own surface need the wash. Everything else
 * already looks right, and touching its classList on every selection change
 * would be churn for nothing.
 */
const WASHABLE_SELECTOR =
  '.milkdown-code-block,.milkdown-table-block,.milkdown-image-block,.ny-html-block';

function coveredBlocks(view: EditorView): HTMLElement[] {
  const { selection, doc } = view.state;
  if (selection.empty) return [];

  const { from, to } = selection;
  const covered: HTMLElement[] = [];
  let offset = 0;

  for (let i = 0; i < doc.childCount; i += 1) {
    const start = offset;
    const end = start + doc.child(i).nodeSize;
    offset = end;

    if (end <= from) continue;
    if (start >= to) break;
    if (from > start || end > to) continue;

    const dom = view.nodeDOM(start);
    if (dom instanceof HTMLElement && dom.matches(WASHABLE_SELECTOR)) {
      covered.push(dom);
    }
  }

  return covered;
}

export const blockSelection = $prose(
  () =>
    new Plugin({
      key: pluginKey,
      view: (editorView) => {
        let marked: HTMLElement[] = [];

        const sync = (view: EditorView) => {
          const next = coveredBlocks(view);
          for (const el of marked) {
            if (!next.includes(el)) el.classList.remove(COVERED_CLASS);
          }
          for (const el of next) el.classList.add(COVERED_CLASS);
          marked = next;
        };

        const clear = () => {
          for (const el of marked) el.classList.remove(COVERED_CLASS);
          marked = [];
        };

        sync(editorView);

        return {
          // `update` runs on every view update, and a drag produces one per
          // mousemove -- so bail before the doc walk unless something that can
          // change the answer actually changed. Both checks hit the identity
          // fast path when nothing moved.
          update: (view: EditorView, prevState: EditorState) => {
            if (
              view.state.doc === prevState.doc &&
              view.state.selection.eq(prevState.selection)
            ) {
              return;
            }
            sync(view);
          },
          destroy: clear,
        };
      },
    })
);
