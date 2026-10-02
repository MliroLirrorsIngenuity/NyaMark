/**
 * A click puts the caret on the line it is nearest, at the column clicked.
 *
 * Beside the text: the page, the frame around the text and the room the text
 * leaves either side hold nothing that can be edited, and a click there left
 * the caret where it was; one in the frame's own padding sent it to the end
 * of the document whatever line it was beside. The caret goes to the end of
 * the line nearer the click, and above or under the text to its start or its
 * end.
 *
 * Over the space above a line: a paragraph's gap from the block before it is
 * its own top padding, and WebKit answers a point in it with the start of the
 * paragraph whatever the column, so a click just over the middle of a line
 * put the caret at its head. The room above a heading, a list or a quote is
 * the editor's own, and WebKit answers it with the start of the block below.
 * The caret goes to the column on the nearest line.
 *
 * Dragging from either takes in the lines it passes, as a drag over the text
 * does.
 */

import { EditorView as CodeMirror } from '@codemirror/view';
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { clickedAt } from './mark-cursor';

/** How far apart the points tried along a line are, and how many. */
const STEP_PX = 8;
const STEPS = 16;

/** How far apart the lines tried over and under a gap are, and how far off. */
const GAP_STEP_PX = 4;
const GAP_REACH_PX = 32;

type Hit = { pos: number; inside: number };

type Spot =
  | { kind: 'text'; pos: number }
  | { kind: 'code'; cm: CodeMirror; pos: number };

/**
 * Where the caret goes for a point in the top padding of a text block, which
 * WebKit takes for the start of the block: the column on its first line.
 * `null` for any other point.
 */
function overLine(view: EditorView, x: number, y: number, hit: Hit) {
  const $pos = view.state.doc.resolve(hit.pos);
  const { parent } = $pos;
  if (!parent.inlineContent || parent.type.spec.code) return null;
  if (hit.pos !== $pos.start() || hit.inside !== $pos.before()) return null;
  const line = view.coordsAtPos(hit.pos, 1);
  if (y >= line.top) return null;
  const top = (line.top + line.bottom) / 2;
  const on = view.posAtCoords({ left: x, top });
  if (!on || view.state.doc.resolve(on.pos).parent !== parent) return null;
  return on.pos;
}

/** The elements of the blocks that hold lines of text. */
const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6';

/** The elements around blocks, which own the room between them. */
const BETWEEN_BLOCKS =
  'ul, ol, blockquote, .milkdown-list-item-block, li, .children, .content-dom';

/**
 * What lies on the line at `y`, from the side of the text `x` is on: the
 * first place along the line from that side that takes a caret, or the code
 * of a code block's line.
 */
function lineAt(view: EditorView, x: number, y: number): Spot | null {
  const box = view.dom.getBoundingClientRect();
  const fromLeft = x < (box.left + box.right) / 2;
  const start = Math.min(Math.max(x, box.left + 1), box.right - 1);
  const step = fromLeft ? STEP_PX : -STEP_PX;
  for (let i = 0; i < STEPS; i++) {
    const at = start + i * step;
    if (at <= box.left || at >= box.right) break;
    const el = view.dom.ownerDocument.elementFromPoint(at, y);
    if (!el || !view.dom.contains(el)) continue;
    const code = el.closest<HTMLElement>('.cm-editor');
    if (code) {
      const cm = CodeMirror.findFromDOM(code);
      const pos = cm?.posAtCoords({ x: at, y }, false);
      if (cm && pos != null) return { kind: 'code', cm, pos };
      continue;
    }
    if (!view.dom.contains(el.closest(TEXT_BLOCK))) continue;
    const hit = view.posAtCoords({ left: at, top: y });
    if (!hit) continue;
    const { parent } = view.state.doc.resolve(hit.pos);
    if (parent.inlineContent && !parent.type.spec.code) {
      return { kind: 'text', pos: overLine(view, at, y, hit) ?? hit.pos };
    }
  }
  return null;
}

/**
 * The line nearest `y` within `reach`, as `lineAt` finds it; the gap between
 * two blocks has none of its own. Above the text it is the start of the
 * document, under it the end.
 */
function spotAt(
  view: EditorView,
  x: number,
  y: number,
  reach: number
): Spot | null {
  const { doc } = view.state;
  const box = view.dom.getBoundingClientRect();
  if (y < box.top) return { kind: 'text', pos: Selection.atStart(doc).from };
  if (y >= box.bottom) return { kind: 'text', pos: Selection.atEnd(doc).to };
  for (let off = 0; off <= reach; off += GAP_STEP_PX) {
    for (const at of off ? [y - off, y + off] : [y]) {
      if (at < box.top || at >= box.bottom) continue;
      const spot = lineAt(view, x, at);
      if (spot) return spot;
    }
  }
  return null;
}

/**
 * The click landed on the page, the frame or the room either side of the
 * text, which hold nothing of their own. The source view shows the text for
 * reading alone.
 */
function bareRoom(view: EditorView, target: EventTarget | null): boolean {
  const frame = view.dom.parentElement;
  const container = frame?.parentElement;
  const page = container?.parentElement;
  if (!frame || !container || !page) return false;
  if (container.classList.contains('is-source-mode')) return false;
  return target === frame || target === container || target === page;
}

/**
 * The click landed in the text between two blocks, on room that belongs to
 * the editor, a list or a quote around them. WebKit answers it with the edge
 * of the block below whatever the column: the start of a heading or a quote
 * for a click beside the end of its line.
 */
function betweenBlocks(view: EditorView, target: EventTarget | null) {
  if (target === view.dom) return true;
  if (!(target instanceof Element) || !view.dom.contains(target)) return false;
  return target.matches(BETWEEN_BLOCKS);
}

export const marginClick = $prose(() => {
  let anchor = -1;
  let held: EditorView | null = null;

  const select = (view: EditorView, head: number, y: number) => {
    const { doc } = view.state;
    const from = anchor < 0 ? head : anchor;
    const selection = TextSelection.between(
      doc.resolve(from),
      doc.resolve(head)
    );
    if (selection.eq(view.state.selection)) return;
    view.dispatch(clickedAt(view.state.tr.setSelection(selection), view, y));
  };
  const onMove = (event: MouseEvent) => {
    if (!held) return;
    const spot = spotAt(held, event.clientX, event.clientY, 0);
    if (spot?.kind === 'text') select(held, spot.pos, event.clientY);
  };
  const onUp = () => {
    anchor = -1;
    held = null;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
  };
  /** Puts the caret at `pos` for the click, and follows the drag from it. */
  const begin = (view: EditorView, pos: number, event: MouseEvent) => {
    event.preventDefault();
    anchor = event.shiftKey ? view.state.selection.anchor : pos;
    select(view, pos, event.clientY);
    view.focus();
    held = view;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  };
  /** Puts the caret at `spot` for the click. */
  const placeAt = (view: EditorView, spot: Spot, event: MouseEvent) => {
    if (spot.kind === 'text') {
      begin(view, spot.pos, event);
      return;
    }
    event.preventDefault();
    spot.cm.focus();
    spot.cm.dispatch({ selection: { anchor: spot.pos } });
  };
  const plain = (view: EditorView, event: MouseEvent) =>
    event.button === 0 &&
    view.editable &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey;

  return new Plugin({
    key: new PluginKey('nyamark/margin-click'),
    view(view) {
      const page = view.dom.parentElement?.parentElement?.parentElement;
      if (!page) return {};
      const onDown = (event: MouseEvent) => {
        if (!plain(view, event) || !bareRoom(view, event.target)) return;
        if (view.dom.getClientRects().length === 0) return;
        const spot = spotAt(view, event.clientX, event.clientY, GAP_REACH_PX);
        if (spot) {
          placeAt(view, spot, event);
          return;
        }
        event.preventDefault();
        view.focus();
      };
      page.addEventListener('mousedown', onDown);
      return {
        destroy() {
          onUp();
          page.removeEventListener('mousedown', onDown);
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!plain(view, event) || event.detail > 1) return false;
          const { clientX: x, clientY: y } = event;
          const hit = view.posAtCoords({ left: x, top: y });
          if (!hit) return false;
          if (event.target === view.nodeDOM(hit.inside)) {
            const pos = overLine(view, x, y, hit);
            if (pos == null) return false;
            begin(view, pos, event);
            return true;
          }
          if (!betweenBlocks(view, event.target)) return false;
          const spot = spotAt(view, x, y, GAP_REACH_PX);
          if (!spot) return false;
          placeAt(view, spot, event);
          return true;
        },
      },
    },
  });
});
