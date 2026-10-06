/**
 * Where the editor's popups stand: the selection toolbar, the link boxes, the
 * box a formula in a line is edited in and the slash menu. Crepe and its
 * components place them with floating-ui and take these options for it.
 *
 * They keep a gutter's width inside the page. Crepe shifts them inside the
 * scrolling page, which runs to the edge of the window: at the default 860px
 * width the toolbar for the first words of a line sat flush against the left
 * edge, its rounded corner and shadow cut off.
 *
 * The format bar pinned along the top of the page is not the page's edge:
 * a popup for a line just under it went above the line, over the bar's own
 * buttons. The room above a line starts under the bar.
 */

import {
  type ComputePositionConfig,
  type MiddlewareState,
  flip,
  inline,
  limitShift,
  offset,
  shift,
  size,
} from '@floating-ui/dom';

/** Room kept between a popup and the edge of the page. */
const GUTTER_PX = 8;
/** Between a line and the popup off it. */
const GAP_PX = 10;
/** Shorter than this the slash menu is no use; it goes on past the edge instead. */
const MENU_MIN_PX = 160;

/** The window under the format bar, where it is shown. */
function inPage({ elements }: MiddlewareState) {
  const bar = elements.floating
    .closest('.milkdown')
    ?.querySelector(':scope > .milkdown-top-bar');
  const top = bar?.getBoundingClientRect().bottom ?? 0;
  return {
    padding: GUTTER_PX,
    rootBoundary: {
      x: 0,
      y: top,
      width: window.innerWidth,
      height: Math.max(0, window.innerHeight - top),
    },
  };
}

/**
 * The selection toolbar goes above the selection, centred on the text
 * selected on its first line, and flips under the last when there is no room
 * above. Where there is none on either side, as for a selection from just
 * under the format bar to past the foot of the page, it moves along the
 * selection into the page.
 */
export const selectionToolbar: Partial<ComputePositionConfig> = {
  placement: 'top',
  middleware: [
    inline(),
    offset(GAP_PX),
    flip(inPage),
    shift((state) => ({
      ...inPage(state),
      crossAxis: true,
      limiter: limitShift(),
    })),
  ],
};

/** A link's preview and edit boxes. */
export const linkBoxes: Partial<ComputePositionConfig> = {
  middleware: [flip(inPage), shift({ padding: GUTTER_PX })],
};

/** The box a formula in a line is edited in, under it. */
export const formulaBox = { shift: { padding: GUTTER_PX } };

/**
 * The slash menu opens under its line where it fits, and otherwise on the
 * side with more room, no taller than that room. At its full height it was
 * taller than either on a line halfway down a window of the default size: it
 * opened under the line and hung below the status bar, its last items out of
 * sight, and the arrow keys walked into them.
 */
export const slashMenu: Partial<ComputePositionConfig> = {
  middleware: [
    offset(GAP_PX),
    flip(inPage),
    size((state) => ({
      ...inPage(state),
      apply({ availableHeight, elements }) {
        const height = Math.max(MENU_MIN_PX, Math.floor(availableHeight));
        elements.floating.style.maxHeight = `${height}px`;
      },
    })),
  ],
};
