/**
 * A code block's language list opens under its button or over it, whichever
 * side has the room, and is no taller than that room. It opened under the
 * button always, and for a block near the foot of the window hung below the
 * status bar, most of the languages out of sight and the arrow keys walking
 * into them.
 */

/** The list's own height, as the stylesheet sets it. */
const LIST_PX = 196;
/** The stylesheet's gap between the button and the list. */
const GAP_PX = 4;
/** Room kept between the list and the edge of the page. */
const MARGIN_PX = 8;
/** Shorter than this the list is no use; it goes on past the edge instead. */
const MIN_LIST_PX = 88;

type Span = { top: number; bottom: number };

/**
 * Which side of `button` the list opens on and the height of its languages,
 * the page showing `page` and the search box and padding taking `chrome`.
 */
export function languageListRoom(button: Span, page: Span, chrome: number) {
  const below = page.bottom - button.bottom - GAP_PX - MARGIN_PX;
  const above = button.top - page.top - GAP_PX - MARGIN_PX;
  const up = below < LIST_PX + chrome && above > below;
  const room = (up ? above : below) - chrome;
  return { up, height: Math.max(MIN_LIST_PX, Math.min(LIST_PX, room)) };
}

function place(root: HTMLElement, button: HTMLElement) {
  const picker = button.parentElement?.querySelector<HTMLElement>(
    ':scope > .language-picker'
  );
  const wrapper = picker?.querySelector<HTMLElement>('.list-wrapper');
  const list = wrapper?.querySelector<HTMLElement>('.language-list');
  const page = root.closest('.ny-shell__body') ?? root;
  if (!picker || !wrapper || !list) return;
  const box = page.getBoundingClientRect();
  const bar = root.querySelector('.milkdown > .milkdown-top-bar');
  const { up, height } = languageListRoom(
    button.getBoundingClientRect(),
    {
      top: Math.max(box.top, bar?.getBoundingClientRect().bottom ?? box.top),
      bottom: Math.min(box.bottom, window.innerHeight),
    },
    wrapper.offsetHeight - list.offsetHeight
  );
  picker.toggleAttribute('data-ny-above', up);
  picker.style.setProperty('--ny-language-list-height', `${height}px`);
}

const OPEN = 'data-ny-language-open';

function markOpen(root: HTMLElement) {
  const open = root.querySelector('.language-button[data-expanded="true"]');
  root.toggleAttribute(OPEN, open !== null);
}

/** Call once the editor is created. */
export function languagePickerRoom(root: HTMLElement) {
  new MutationObserver((records) => {
    for (const { target } of records) {
      if (target instanceof HTMLElement && target.dataset.expanded === 'true') {
        place(root, target);
      }
    }
    markOpen(root);
  }).observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-expanded'],
  });
  root.addEventListener('pointerover', () => {
    if (root.hasAttribute(OPEN)) markOpen(root);
  });
}
