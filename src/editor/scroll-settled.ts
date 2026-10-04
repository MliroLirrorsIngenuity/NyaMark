/**
 * Scrolls `target` into view and holds it there while the page settles.
 *
 * Diagrams are drawn as they come near the screen and pictures take their
 * height as they load, so the page grows under a scroll on its way. A smooth
 * scroll stopped at the first diagram it passed, whose drawing moved the page
 * to keep what was on screen: the outline left the last heading of a long
 * article five thousand pixels below. A target more than a screen away is
 * jumped to, and aimed at again at each frame until it holds still for a
 * while, or the reader takes the page.
 */

const STILL_MS = 600;
const LONGEST_MS = 3000;
const READER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'];

let stopAiming: (() => void) | null = null;

export function scrollIntoViewSettled(
  target: HTMLElement,
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
  const started = performance.now();
  let moved = started;
  let aimed = target.getBoundingClientRect().top;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of READER_INPUT) {
      window.removeEventListener(type, stop, true);
    }
    if (stopAiming === stop) stopAiming = null;
  };
  const aim = (now: number) => {
    if (
      !target.isConnected ||
      now - started > LONGEST_MS ||
      now - moved > STILL_MS
    ) {
      stop();
      return;
    }
    if (Math.abs(target.getBoundingClientRect().top - aimed) >= 1) {
      moved = now;
      target.scrollIntoView({ behavior: 'auto', block });
      aimed = target.getBoundingClientRect().top;
    }
    frame = requestAnimationFrame(aim);
  };
  for (const type of READER_INPUT) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  frame = requestAnimationFrame(aim);
  stopAiming = stop;
}
