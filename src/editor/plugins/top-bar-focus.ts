/**
 * A press on the format bar off its buttons leaves the caret in the page. It
 * took the focus from the page, and the caret with it, so that what was typed
 * next went nowhere; the buttons themselves leave the focus where it is.
 */

/** Call once the editor is created. Crepe adds the bar as it is created. */
export function keepFocusOffBar(root: HTMLElement) {
  root
    .querySelector<HTMLElement>('.milkdown > .milkdown-top-bar')
    ?.addEventListener('mousedown', (event) => event.preventDefault());
}
