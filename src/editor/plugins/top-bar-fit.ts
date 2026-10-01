/**
 * Packs the format bar tighter on a narrow page (a small window with the
 * outline open); at its full spacing it needs about 750px and ran off both
 * ends.
 *
 * A container query on the bar did this, but WebKit then scrolled the page
 * as an arrow key took the caret from a heading into a paragraph or back:
 * the line the caret came to was pulled to two thirds of the way down the
 * window, however near it already was. A class on the editor root, set by
 * the width the bar has inside it, makes no size container of the bar.
 */

/** The width of the bar's buttons, without its padding, at full spacing. */
const NARROW_PX = 760;
const NARROW_CLASS = 'ny-top-bar-narrow';

/** Call once the editor is created. Crepe adds the bar as it is created. */
export function fitTopBar(root: HTMLElement) {
  const editor = root.querySelector<HTMLElement>('.milkdown');
  if (!editor) return;
  let width = -1;
  new ResizeObserver(([entry]) => {
    // The page grows with every line typed; only its width matters here.
    if (!entry || entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    const bar = editor.querySelector<HTMLElement>(':scope > .milkdown-top-bar');
    if (!bar) return;
    const style = getComputedStyle(bar);
    const inner =
      bar.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    editor.classList.toggle(NARROW_CLASS, inner <= NARROW_PX);
  }).observe(editor);
}
