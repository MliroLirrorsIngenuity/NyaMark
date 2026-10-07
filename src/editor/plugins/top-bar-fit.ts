/**
 * Packs the format bar tighter on a narrow page (a small window with the
 * outline open); at its full spacing it needs about 750px and ran off both
 * ends. Packed it still needs about 520px, more than the page has with the
 * assistant open beside a small window, which then scrolled sideways: there
 * the bar breaks between its groups onto more rows.
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
const WRAP_CLASS = 'ny-top-bar-wrap';

const px = (value: string) => Number.parseFloat(value) || 0;

/** The width inside an element's padding. */
function room(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
}

/**
 * Whether the bar's groups, on one row with the dividers between them at
 * their narrowest, need more room than the row has. The dividers grow to
 * fill the row, so where the buttons end tells nothing.
 */
function tooWide(row: HTMLElement): boolean {
  let need = 0;
  for (const child of row.children) {
    need += child.classList.contains('top-bar-divider')
      ? px(getComputedStyle(child).minWidth)
      : child.getBoundingClientRect().width;
  }
  return need > room(row);
}

function fit(editor: HTMLElement, bar: HTMLElement, row: HTMLElement) {
  editor.classList.toggle(NARROW_CLASS, room(bar) <= NARROW_PX);
  // Measured on one row: the buttons' width differs by language.
  editor.classList.remove(WRAP_CLASS);
  if (tooWide(row)) editor.classList.add(WRAP_CLASS);
}

/** Call once the editor is created. Crepe adds the bar as it is created. */
export function fitTopBar(root: HTMLElement) {
  const editor = root.querySelector<HTMLElement>('.milkdown');
  const bar = editor?.querySelector<HTMLElement>(':scope > .milkdown-top-bar');
  if (!editor || !bar) return;
  const scroller = editor.closest<HTMLElement>('.ny-shell__body');
  let fitted = '';
  const check = () => {
    // A bar taken away with its editor tells nothing of the next one's.
    if (!bar.isConnected) return;
    // The page's scroll padding is as tall as the bar, so a heading the
    // outline scrolls to, or a match found, clears it however many rows it
    // takes.
    const height = bar.offsetHeight;
    if (height > 0) {
      scroller?.style.setProperty('--ny-top-bar-height', `${height}px`);
    } else scroller?.style.removeProperty('--ny-top-bar-height');
    // The page grows with every line typed and the bar with its rows: only
    // their widths matter here. The bar has no buttons until a long
    // document is drawn in full (see open-in-parts).
    const row = bar.querySelector<HTMLElement>(':scope > .top-bar-inner');
    const widths = `${editor.clientWidth} ${bar.clientWidth}`;
    if (!row || bar.clientWidth === 0 || widths === fitted) return;
    fitted = widths;
    fit(editor, bar, row);
  };
  const resized = new ResizeObserver(check);
  resized.observe(editor);
  resized.observe(bar);
  new MutationObserver(check).observe(bar, { childList: true });
}
