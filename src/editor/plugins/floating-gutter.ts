/**
 * Keeps the selection toolbar and the link popups a gutter's width inside the
 * page. Crepe centres them over the selection or the link and shifts them
 * back inside the scrolling page, which runs to the edge of the window: at
 * the default 860px width, selecting the first words of a line put the
 * toolbar flush against the left edge, its rounded corner and shadow cut off.
 *
 * Crepe owns their positioning and takes no padding for it, so the position
 * it writes is nudged once it lands.
 */

const GUTTER_PX = 8;
const FLOATING =
  '.milkdown-toolbar, .milkdown-link-edit, .milkdown-link-preview';

/** The `left` each popup was last moved to, so its own write is not redone. */
const written = new WeakMap<HTMLElement, string>();

function nudge(el: HTMLElement) {
  const left = Number.parseFloat(el.style.left);
  if (Number.isNaN(left) || el.dataset.show !== 'true') return;
  if (written.get(el) === el.style.left) return;
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
  if (Math.abs(target - box.left) < 0.5) return;
  el.style.left = `${left + target - box.left}px`;
  written.set(el, el.style.left);
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
