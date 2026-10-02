/**
 * The format bar's heading list closes on Escape, and on any other key, which
 * goes on to the page. It closed only on a click elsewhere: with the caret
 * still in the page, Escape left it open, what was typed went on under it out
 * of sight, and the next click on the text there chose one of its headings.
 */

import { pushEscapeLayer } from '../../ui/escape-layers';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/** Call once the editor is created. Crepe adds the bar as it is created. */
export function closeHeadingListOnKeys(root: HTMLElement) {
  const bar = root.querySelector<HTMLElement>('.milkdown > .milkdown-top-bar');
  if (!bar) return;
  // The list is Crepe's own state, opened and closed by a press on its button.
  // No button is pressed, so the press reads as no click to anything else.
  const close = () => {
    bar
      .querySelector('.top-bar-heading-button')
      ?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: -1 })
      );
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || MODIFIERS.has(event.key)) return;
    close();
  };
  let release: (() => void) | null = null;
  new MutationObserver(() => {
    const open = bar.querySelector('.top-bar-heading-dropdown') !== null;
    if (open && !release) {
      const releaseEscape = pushEscapeLayer({ dismiss: close });
      document.addEventListener('keydown', onKey, true);
      release = () => {
        releaseEscape();
        document.removeEventListener('keydown', onKey, true);
      };
    } else if (!open && release) {
      release();
      release = null;
    }
  }).observe(bar, { childList: true, subtree: true });
}
