import type { EditorView } from 'prosemirror-view';

/**
 * A heading is the one being read once its top is less than this far below
 * the top of the page. `scrollToHeading` leaves a heading 72px down, under
 * the sticky top bar.
 */
export const READING_LINE_PX = 96;

/** The element the document scrolls in: the preview pane in source mode. */
export function scrollHostOf(el: Element): Element | null {
  return (
    el.closest('#ny-editor-container.is-source-mode > .milkdown') ??
    el.closest('.ny-shell__body')
  );
}

/**
 * The document reflows when a side panel opens or closes. The line at the
 * top of the page is put back where it was, or the reader lost their place.
 */
export function keepReadingPosition(
  view: EditorView | null,
  change: () => void
) {
  const host = view && scrollHostOf(view.dom);
  if (!view || !host || host.scrollTop === 0) {
    change();
    return;
  }
  const box = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({
    left: box.left + box.width / 2,
    top: host.getBoundingClientRect().top + READING_LINE_PX,
  });
  const before = hit && view.coordsAtPos(hit.pos).top;
  change();
  if (hit && before != null) {
    host.scrollTop += view.coordsAtPos(hit.pos).top - before;
  }
}
