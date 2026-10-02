/**
 * Keeps the selection toolbar, the link popups and the box a formula in a
 * line is edited in a gutter's width inside the page. Crepe centres them over
 * the selection, the link or the formula and shifts them back inside the
 * scrolling page, which runs to the edge of the window: at the default 860px
 * width, selecting the first words of a line put the toolbar flush against
 * the left edge, its rounded corner and shadow cut off, and a formula at the
 * start of a line had its box there too.
 *
 * Crepe centres the selection toolbar between the two ends of the selection,
 * and from the start of one line to the start of another both ends are at
 * the left of the page: the toolbar sat in the left gutter, away from the
 * text selected, whatever its length. It is centred on the text selected on
 * the line it sits by: the first, or the last when it sits under the whole
 * selection. Centred on the first there, it hung beside the end of a short
 * last line, under nothing selected.
 *
 * The selection toolbar goes above the selection, and flips below it only
 * when the page runs out above. The format bar pinned along the top of the
 * page is not the page's edge, so text selected on the line just under it put
 * the toolbar over the bar's own buttons. There it goes below the selection
 * instead, or below its first line when the rest runs out of view.
 *
 * The lines are those of the text selected. A selection from the end of a
 * line holds nothing on it, and a block it takes whole has a box as wide as
 * the page: the toolbar stood a line above the text selected, centred on the
 * page.
 *
 * Crepe owns their positioning and takes no padding for it, so the position
 * it writes is nudged once it lands.
 */

const GUTTER_PX = 8;
/** Crepe's distance between the selection and its toolbar. */
const TOOLBAR_OFFSET_PX = 10;
const FLOATING = [
  '.milkdown-toolbar',
  '.milkdown-link-edit',
  '.milkdown-link-preview',
  '.milkdown-latex-inline-edit',
].join(', ');

/** The position each popup was last moved to, so its own write is not redone. */
const written = new WeakMap<HTMLElement, string>();

/** The text nodes `range` takes in, in order: none of a widget's labels. */
function textsIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root instanceof Text) return [root];
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) {
      if (texts.length) break;
      continue;
    }
    if (node instanceof Text && node.parentElement?.isContentEditable) {
      texts.push(node);
    }
  }
  return texts;
}

/** A box for each line of `text` that `range` selects. */
function boxesOf(text: Text, range: Range): DOMRect[] {
  const part = document.createRange();
  part.selectNodeContents(text);
  if (text === range.startContainer) part.setStart(text, range.startOffset);
  if (text === range.endContainer) part.setEnd(text, range.endOffset);
  return Array.from(part.getClientRects()).filter((box) => box.width >= 1);
}

/** The text selected on the first line with any (`step` 1) or the last (-1). */
function lineOf(texts: Text[], range: Range, step: 1 | -1): DOMRect | null {
  let line: DOMRect | null = null;
  for (
    let i = step > 0 ? 0 : texts.length - 1;
    i >= 0 && i < texts.length;
    i += step
  ) {
    const boxes = boxesOf(texts[i], range);
    if (step < 0) boxes.reverse();
    for (const box of boxes) {
      if (!line) {
        line = box;
        continue;
      }
      const middle = (box.top + box.bottom) / 2;
      if (middle < line.top || middle > line.bottom) return line;
      const left = Math.min(line.left, box.left);
      const right = Math.max(line.right, box.right);
      const top = Math.min(line.top, box.top);
      const bottom = Math.max(line.bottom, box.bottom);
      line = new DOMRect(left, top, right - left, bottom - top);
    }
  }
  return line;
}

/**
 * How far down the selection toolbar moves to sit by the text selected, clear
 * of the format bar, and the line of it it then sits by.
 */
function bySelection(
  el: HTMLElement,
  box: DOMRect,
  page: DOMRect
): { dy: number; line: DOMRect } | null {
  if (!el.classList.contains('milkdown-toolbar')) return null;
  const selection = getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const texts = textsIn(range);
  const first = lineOf(texts, range, 1);
  const last = lineOf(texts, range, -1);
  if (!first || !last) return null;
  const bar = el
    .closest('.milkdown')
    ?.querySelector('.milkdown-top-bar')
    ?.getBoundingClientRect();
  const ceiling = (bar?.height ? bar.bottom : page.top) + GUTTER_PX;
  const above = first.top - TOOLBAR_OFFSET_PX - box.height;
  if (above >= ceiling) return { dy: above - box.top, line: first };
  const fits =
    last.bottom + TOOLBAR_OFFSET_PX + box.height <= page.bottom - GUTTER_PX;
  const line = fits ? last : first;
  return { dy: line.bottom + TOOLBAR_OFFSET_PX - box.top, line };
}

function nudge(el: HTMLElement) {
  const left = Number.parseFloat(el.style.left);
  const top = Number.parseFloat(el.style.top);
  if (Number.isNaN(left) || Number.isNaN(top)) return;
  if (el.dataset.show !== 'true') return;
  if (written.get(el) === `${el.style.left} ${el.style.top}`) return;
  const page = (
    el.closest('.ny-shell__body') ?? document.documentElement
  ).getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const min = page.left + GUTTER_PX;
  const max = page.right - GUTTER_PX;
  const by = bySelection(el, box, page);
  const dy = by?.dy ?? 0;
  const centred = by
    ? by.line.left + (by.line.width - box.width) / 2
    : box.left;
  // A popup wider than the room left keeps its start in view.
  const target =
    box.width > max - min
      ? min
      : Math.min(Math.max(centred, min), max - box.width);
  const dx = target - box.left;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  el.style.left = `${left + dx}px`;
  el.style.top = `${top + dy}px`;
  written.set(el, `${el.style.left} ${el.style.top}`);
}

/** Call once the editor is created: the popups exist from then on. */
export function keepFloatingOffEdge(root: HTMLElement) {
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (target instanceof HTMLElement) nudge(target);
    }
  });
  for (const el of root.querySelectorAll<HTMLElement>(FLOATING)) {
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['style', 'data-show'],
    });
  }
}
