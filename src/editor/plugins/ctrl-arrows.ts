/**
 * ⌃N, ⌃P, ⌃F and ⌃B move the caret as the arrow keys do. The Mac moves it a
 * line or a character for them in any text, and ProseMirror reads them as
 * arrows, but every step the editor takes over from the browser answered the
 * arrows alone: ⌃N going down lost the column on the way into code, crossed a
 * table row a cell at a time, picked out a rule and a picture on its way, and
 * went past a formula as if it were not there.
 *
 * The key reaches the editor, or the code block the caret is in, as the arrow
 * it stands for. Where nothing takes that arrow, the browser moves the caret
 * for the key itself, a line or a character as it would for the arrow.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { isMacOS } from '../../platform/detect';

const ARROWS: Record<string, [key: string, code: number]> = {
  n: ['ArrowDown', 40],
  p: ['ArrowUp', 38],
  f: ['ArrowRight', 39],
  b: ['ArrowLeft', 37],
};

/** The arrow `event` stands for, with Shift kept. */
function arrowFor(event: KeyboardEvent): KeyboardEvent | null {
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.isComposing) return null;
  const arrow = ARROWS[event.key.toLowerCase()];
  if (!arrow) return null;
  const [key, code] = arrow;
  const stand = new KeyboardEvent('keydown', {
    key,
    code: key,
    shiftKey: event.shiftKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  // ProseMirror's own arrows go by the key code.
  Object.defineProperty(stand, 'keyCode', { value: code });
  Object.defineProperty(stand, 'which', { value: code });
  return stand;
}

export const ctrlArrows = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/ctrl-arrows'),
      view(view) {
        const root = view.dom.parentElement;
        if (!root || !isMacOS()) return {};
        // Ahead of everything in the editor, CodeMirror's keys too.
        const onKeyDown = (event: KeyboardEvent) => {
          const { target } = event;
          if (!(target instanceof HTMLElement)) return;
          if (target !== view.dom && !target.classList.contains('cm-content')) {
            return;
          }
          const stand = arrowFor(event);
          if (!stand) return;
          event.stopPropagation();
          if (!target.dispatchEvent(stand)) event.preventDefault();
        };
        root.addEventListener('keydown', onKeyDown, true);
        return {
          destroy: () => root.removeEventListener('keydown', onKeyDown, true),
        };
      },
    })
);
