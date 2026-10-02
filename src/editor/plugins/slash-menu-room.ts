/**
 * The slash menu is as tall as the room under its line or over it, whichever
 * is more, and opens on that side. At its full height it was taller than
 * either on a line halfway down a window of the default size: it opened under
 * the line and hung below the status bar, its last items out of sight, and the
 * arrow keys walked into them.
 *
 * The room is taken after each change, once the page has scrolled to the
 * caret and before the menu, which waits a little longer, places itself.
 */

import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** Crepe's gap between the line and the menu. */
const OFFSET_PX = 10;
/** Room kept between the menu and the edge of the page. */
const MARGIN_PX = 8;
/** Shorter than this the menu is no use; it goes on past the edge instead. */
const MIN_PX = 160;

type Span = { top: number; bottom: number };

/** The menu's height for a caret on `line`, the page showing `page`. */
export function menuRoom(line: Span, page: Span): number {
  const below = page.bottom - line.bottom;
  const above = line.top - page.top;
  return Math.max(MIN_PX, Math.max(below, above) - OFFSET_PX - MARGIN_PX);
}

/**
 * Whether the slash menu may open at the selection: an empty line, `/…` or
 * `、…`, which the Chinese input method types for the same key.
 */
function mayOpen(view: EditorView): boolean {
  const { selection } = view.state;
  const { parent } = selection.$from;
  if (!selection.empty || !parent.isTextblock) return false;
  if (parent.type.spec.code) return false;
  const text = parent.textContent;
  return text === '' || text.startsWith('/') || text.startsWith('、');
}

/** Sets the menu's room for the caret where it stands. */
function fit(view: EditorView) {
  if (view.isDestroyed || !mayOpen(view)) return;
  const page = view.dom.closest('.ny-shell__body');
  const holder = view.dom.parentElement;
  if (!page || !holder) return;
  const box = page.getBoundingClientRect();
  const bar = view.dom
    .closest('.milkdown')
    ?.querySelector(':scope > .milkdown-top-bar');
  const barBottom = bar?.getBoundingClientRect().bottom ?? box.top;
  const room = menuRoom(view.coordsAtPos(view.state.selection.head), {
    top: Math.max(box.top, barBottom),
    bottom: Math.min(box.bottom, window.innerHeight),
  });
  holder.style.setProperty('--ny-slash-menu-room', `${Math.floor(room)}px`);
}

export const slashMenuRoom = $prose(
  () =>
    new Plugin({
      view() {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return {
          update(view) {
            clearTimeout(timer);
            timer = setTimeout(() => fit(view), 0);
          },
          destroy() {
            clearTimeout(timer);
          },
        };
      },
    })
);
