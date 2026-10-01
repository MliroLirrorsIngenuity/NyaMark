/**
 * Keeps the selection toolbar, the link popups and the box a formula in a
 * line is edited in a gutter's width inside the page. Crepe centres them over
 * the selection, the link or the formula and shifts them back inside the
 * scrolling page, which runs to the edge of the window: at the default 860px
 * width, selecting the first words of a line put the toolbar flush against
 * the left edge, its rounded corner and shadow cut off, and a formula at the
 * start of a line had its box there too.
 *
 * The selection toolbar goes above the selection, and flips below it only
 * when the page runs out above. The format bar pinned along the top of the
 * page is not the page's edge, so text selected on the line just under it put
 * the toolbar over the bar's own buttons. There it goes below the selection
 * instead, or below its first line when the rest runs out of view.
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

/** How far down the selection toolbar moves to keep off the format bar. */
function clearOfBar(el: HTMLElement, box: DOMRect, page: DOMRect): number {
  if (!el.classList.contains('milkdown-toolbar')) return 0;
  const bar = el.closest('.milkdown')?.querySelector('.milkdown-top-bar');
  if (!bar) return 0;
  const barBox = bar.getBoundingClientRect();
  if (barBox.height === 0 || box.top >= barBox.bottom + GUTTER_PX) return 0;
  const selection = getSelection();
  if (!selection?.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  const whole = range.getBoundingClientRect();
  const fits =
    whole.bottom + TOOLBAR_OFFSET_PX + box.height <= page.bottom - GUTTER_PX;
  const under = fits
    ? whole.bottom
    : (range.getClientRects()[0]?.bottom ?? whole.bottom);
  return under + TOOLBAR_OFFSET_PX - box.top;
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
  // A popup wider than the room left keeps its start in view.
  const target =
    box.width > max - min
      ? min
      : Math.min(Math.max(box.left, min), max - box.width);
  const dx = target - box.left;
  const dy = clearOfBar(el, box, page);
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
