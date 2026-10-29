/** The page's selection, read before the menu takes the focus and marked while it has it. */

const HIGHLIGHT = 'ny-ai-quick';

/** Where the selection or the caret is on screen, from the page's selection. */
export function selectionRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0).cloneRange();
}

/** Marks the selection while the menu has the focus, as the page no longer does. */
export function markSelection(range: Range | null) {
  if (!range || range.collapsed || typeof Highlight === 'undefined') return;
  CSS.highlights?.set(HIGHLIGHT, new Highlight(range));
}

export function clearSelectionMark() {
  if (typeof Highlight === 'undefined') return;
  CSS.highlights?.delete(HIGHLIGHT);
}
