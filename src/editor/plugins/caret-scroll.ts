/**
 * The page follows the caret a line at a time, and keeps its line out from
 * under the format bar.
 *
 * WebKit moves the caret for most arrow keys, and on the Mac it brings a
 * caret that leaves the window back to the middle of it: walking down the
 * page a line at a time, the page leapt half a window at its foot, where
 * typing on the last line moves it a line. After the key the page goes back
 * to where it stood and moves only as far as keeps the caret's line in sight.
 * The browser has moved the caret by the next frame, before it draws one, so
 * the leap is never seen.
 *
 * The format bar is pinned over the top of the page, and every scroll to the
 * caret -- WebKit's, ProseMirror's, CodeMirror's -- took the top of the page
 * for the top of what is in sight: going up, the caret went on under the bar
 * and the line it stood on was hidden there.
 *
 * A code block's caret is CodeMirror's. ProseMirror scrolled to the top of the
 * block instead, and the caret going down into a block at the foot of the page
 * stood on its first line out of sight. CodeMirror scrolls to its own caret.
 */

import { EditorView as CodeMirror } from '@codemirror/view';
import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** ProseMirror's own room around the caret when it scrolls to it. */
const MARGIN_PX = 5;

/** How far down the page the format bar pinned over its top reaches. */
function barCover(el: Element): number {
  const page = el.closest('.ny-shell__body');
  const bar = el
    .closest('.milkdown')
    ?.querySelector(':scope > .milkdown-top-bar');
  if (!page || !bar || bar.getClientRects().length === 0) return 0;
  const reach =
    bar.getBoundingClientRect().bottom - page.getBoundingClientRect().top;
  return Math.max(0, reach);
}

/** A code block's CodeMirror leaves room for the format bar too. */
export const codeClearOfBar = CodeMirror.scrollMargins.of((cm) => ({
  top: barCover(cm.dom),
}));

/** ProseMirror's room around the caret, the top set as each scroll begins. */
const threshold = { top: 0, right: 0, bottom: 0, left: 0 };
const margin = {
  top: MARGIN_PX,
  right: MARGIN_PX,
  bottom: MARGIN_PX,
  left: MARGIN_PX,
};

/** Has the code block holding the caret scroll to it. */
function scrollToCode(view: EditorView): boolean {
  const { selection } = view.state;
  const { $head } = selection;
  if (
    selection instanceof NodeSelection ||
    $head.parent.type.name !== 'code_block'
  ) {
    return false;
  }
  const block = view.nodeDOM($head.before());
  const dom =
    block instanceof HTMLElement ? block.querySelector('.cm-editor') : null;
  const cm = dom instanceof HTMLElement ? CodeMirror.findFromDOM(dom) : null;
  if (!cm) return false;
  cm.dispatch({
    effects: CodeMirror.scrollIntoView(cm.state.selection.main.head, {
      yMargin: MARGIN_PX,
    }),
  });
  return true;
}

/** Where the browser's caret is drawn, in ProseMirror or in a code block. */
function caretBox(view: EditorView, selection: Selection, focus: Node) {
  const code = (
    focus instanceof Element ? focus : focus.parentElement
  )?.closest<HTMLElement>('.cm-editor');
  try {
    if (!code) {
      return view.coordsAtPos(view.posAtDOM(focus, selection.focusOffset));
    }
    // The caret came in from a line beside the block: CodeMirror took it up
    // from the browser without scrolling to it.
    const cm = CodeMirror.findFromDOM(code);
    return cm?.coordsAtPos(cm.posAtDOM(focus, selection.focusOffset)) ?? null;
  } catch {
    return null;
  }
}

/** Takes the page from `before` only as far as brings the caret into sight. */
function follow(view: EditorView, page: HTMLElement, before: number) {
  const selection = view.dom.ownerDocument.getSelection();
  const focus = selection?.focusNode;
  if (!selection || !focus || !view.dom.contains(focus)) return;
  const caret = caretBox(view, selection, focus);
  if (!caret) return;
  const box = page.getBoundingClientRect();
  const top = box.top + barCover(view.dom) + MARGIN_PX;
  const bottom = box.bottom - MARGIN_PX;
  // Where the caret stands with the page put back.
  const back = page.scrollTop - before;
  let by = 0;
  if (caret.top + back < top) by = caret.top + back - top;
  else if (caret.bottom + back > bottom) by = caret.bottom + back - bottom;
  const target = before + by;
  if (Math.abs(page.scrollTop - target) >= 1) page.scrollTop = target;
}

export const caretScroll = $prose(() => {
  let pending = false;
  return new Plugin({
    key: new PluginKey('nyamark/caret-scroll'),
    props: {
      scrollThreshold: threshold,
      scrollMargin: margin,
      handleScrollToSelection(view) {
        const top = barCover(view.dom) + MARGIN_PX;
        threshold.top = top;
        margin.top = top;
        return scrollToCode(view);
      },
      handleKeyDown(view, event) {
        if (
          pending ||
          !ARROWS.has(event.key) ||
          event.metaKey ||
          event.ctrlKey ||
          event.isComposing
        ) {
          return false;
        }
        const page = view.dom.closest<HTMLElement>('.ny-shell__body');
        if (!page) return false;
        // Held down, the key repeats faster than frames are drawn: the page
        // goes back to where it stood before the first of them.
        pending = true;
        const before = page.scrollTop;
        requestAnimationFrame(() => {
          pending = false;
          follow(view, page, before);
        });
        return false;
      },
    },
  });
});
