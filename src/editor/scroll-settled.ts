/**
 * Scrolls `target` into view and holds it there while the page settles.
 *
 * Diagrams are drawn as they come near the screen and pictures take their
 * height as they load, so the page grows under a scroll on its way. A smooth
 * scroll stopped at the first diagram it passed, whose drawing moved the page
 * to keep what was on screen: the outline left the last heading of a long
 * article five thousand pixels below. A target more than a screen away is
 * jumped to, and aimed at again each time the document changes size, until
 * the reader takes the page.
 */

const READER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'];

let stopAiming: (() => void) | null = null;

export function scrollIntoViewSettled(
  target: HTMLElement,
  content: HTMLElement,
  block: ScrollLogicalPosition,
  smooth: boolean
) {
  stopAiming?.();
  const scroller = target.closest<HTMLElement>('.ny-shell__body');
  const top = scroller?.getBoundingClientRect().top ?? 0;
  const screen = scroller?.clientHeight ?? window.innerHeight;
  const distance = Math.abs(target.getBoundingClientRect().top - top);
  if (smooth && distance < screen * 1.5) {
    target.scrollIntoView({ behavior: 'smooth', block });
    return;
  }

  target.scrollIntoView({ behavior: 'auto', block });
  // Called after layout and before paint, so the page never shows off aim.
  const resized = new ResizeObserver(() => {
    if (target.isConnected) target.scrollIntoView({ behavior: 'auto', block });
    else stop();
  });
  const stop = () => {
    resized.disconnect();
    for (const type of READER_INPUT) {
      window.removeEventListener(type, stop, true);
    }
    if (stopAiming === stop) stopAiming = null;
  };
  for (const type of READER_INPUT) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  resized.observe(content);
  stopAiming = stop;
}
