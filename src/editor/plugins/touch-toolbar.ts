import { isCompactLayout } from '../../ui/viewport';

/** Crepe runs on pointerdown; a finger scrolling the bar must not format text. */
export function bindTouchToolbar(bar: HTMLElement) {
  let press: {
    button: HTMLElement;
    x: number;
    y: number;
    moved: boolean;
  } | null = null;
  bar.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || !isCompactLayout()) return;
      const button = (event.target as Element).closest<HTMLElement>('button');
      if (!button) return;
      // Keep the document's selection and keyboard while operating its tools.
      event.preventDefault();
      event.stopImmediatePropagation();
      press = { button, x: event.clientX, y: event.clientY, moved: false };
    },
    true
  );
  bar.addEventListener('pointermove', (event) => {
    if (
      press &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
    ) {
      press.moved = true;
    }
  });
  bar.addEventListener('pointercancel', () => {
    press = null;
  });
  bar.addEventListener('pointerup', (event) => {
    const tap = press;
    press = null;
    if (!tap || tap.moved || !tap.button.contains(event.target as Node)) return;
    event.preventDefault();
    tap.button.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 0,
      })
    );
  });
}
