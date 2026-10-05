/**
 * The caret at the edge of inline code, drawn on the side typing goes to.
 * Adapted from prosemirror-virtual-cursor (MIT, ocavue), which Crepe uses and
 * which knows an edge only between two runs of text.
 *
 * At the end of a line ending in inline code nothing comes after the code, so
 * → went on to the next line and all that was typed at the end went into the
 * code: `npm install` took the X typed after it as `npm installX`. Here the
 * start and the end of a block count as text with no marks: → at the end of
 * a line steps out of the code before it moves on, ← at the start of one does
 * the same, and the format bar's buttons light for the marks typing goes on
 * in.
 *
 * Only code's edges hold the arrow keys for a press, as the caret is drawn
 * against the code's text inside and past its box outside. At the edges of
 * bold, italic, a strike or a link the caret stood still for the press, so
 * an arrow seemed to do nothing; there the arrows go by letters, typing takes
 * the marks of the letter before as on a Mac, and a link is left at its ends
 * (see link-mark).
 *
 * A click past the end of code puts the caret outside it, as ⌘→ or End to
 * the end of the line does, and a click on its text puts it inside. A paste
 * that ends in code or a link leaves the caret outside it too: the space
 * typed after a pasted address went into its link.
 */

import {
  Mark,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

type Side = readonly Mark[];

/** The marks on each side of `$pos`; the edges of its block have none. */
export function marksAround($pos: ResolvedPos): [Side, Side] {
  const index = $pos.index();
  const after = $pos.parent.maybeChild(index);
  const before = $pos.textOffset
    ? after
    : index > 0
      ? $pos.parent.maybeChild(index - 1)
      : null;
  return [before?.marks ?? Mark.none, after?.marks ?? Mark.none];
}

/** The marks typing takes at an empty text selection. */
const typedMarks = (state: EditorState, $pos: ResolvedPos) =>
  state.storedMarks ?? $pos.marks();

/**
 * ← or → at an edge of code goes over to the other side of it first. Moving
 * onto one over a character keeps the marks of that character, so the caret
 * lands on the side it came from.
 */
export function stepOver(state: EditorState, key: string): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const left = key === 'ArrowLeft';
  const $pos = selection.$head;
  const around = marksAround($pos);
  if (codeEdge(...around)) {
    const side = around[left ? 0 : 1];
    if (!Mark.sameSet(side, typedMarks(state, $pos))) {
      return state.tr.setStoredMarks(side);
    }
  }
  const over = left ? $pos.nodeBefore : $pos.nodeAfter;
  if (!over?.isText) return null;
  const onto = $pos.pos + (left ? -1 : 1);
  if (!codeEdge(...marksAround(state.doc.resolve(onto)))) return null;
  const to = TextSelection.create(state.doc, onto);
  return state.tr.setSelection(to).setStoredMarks(over.marks);
}

const isCode = (mark: Mark) => !!mark.type.spec.code;

/**
 * The marks for a click at `pos`, when it is at the edge of code: those of
 * the side clicked on.
 */
export function clickedSide(
  $pos: ResolvedPos,
  target: Element | null
): Side | null {
  const [before, after] = marksAround($pos);
  if (Mark.sameSet(before, after)) return null;
  const edge = [...before, ...after].find(
    (mark) => isCode(mark) && !!mark.isInSet(before) !== !!mark.isInSet(after)
  );
  if (!edge) return null;
  const inside = !!target?.closest('code');
  return !!edge.isInSet(before) === inside ? before : after;
}

/** -1 or 1 for a key that takes the caret to the start or the end of a line. */
function jumpOf(event: KeyboardEvent): -1 | 0 | 1 {
  if (event.shiftKey || event.altKey || event.ctrlKey) return 0;
  if (event.isComposing) return 0;
  const { key } = event;
  if (event.metaKey) {
    if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
    return key === 'ArrowRight' || key === 'ArrowDown' ? 1 : 0;
  }
  return key === 'Home' ? -1 : key === 'End' ? 1 : 0;
}

/**
 * The caret taken to the end of a line (`dir` 1) or its start (-1) goes
 * outside the code there, as a click past it does.
 */
export function outsideAtEdge(
  state: EditorState,
  dir: -1 | 1
): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $pos = selection.$head;
  const edge = dir > 0 ? $pos.parent.content.size : 0;
  if ($pos.parentOffset !== edge) return null;
  const [before, after] = marksAround($pos);
  const inner = dir > 0 ? before : after;
  if (!inner.some(isCode)) return null;
  return state.tr.setStoredMarks(Mark.none);
}

/** The caret right after code or a link just pasted, outside it. */
export function outsideAfterPaste(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const [before, after] = marksAround(selection.$head);
  const ending = before.filter(
    (mark) =>
      (isCode(mark) || mark.type.name === 'link') && !mark.isInSet(after)
  );
  if (!ending.length) return null;
  return state.tr.setStoredMarks(
    before.filter((mark) => !ending.includes(mark))
  );
}

type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * How the caret came to where it is, which settles the side of a break in a
 * wrapped line it is drawn on: a key that takes it to the end of the line
 * above (-1) or the start of the one below (1), ↑ or ↓ from the line at a
 * height in the editor, a click at a height in it, or typing and deleting
 * back, which leave it after the letter before it.
 */
type Came =
  | { side: -1 | 1 }
  | { line: number; dir: -1 | 1 }
  | { y: number }
  | { typed: true };

const middle = (rect: Rect, top: number) => (rect.top + rect.bottom) / 2 - top;

/**
 * The side of a break in a wrapped line the caret is drawn on, and its box
 * there; the end of one line and the start of the next are one place in the
 * text. It goes to the end after End, ⌘→, a click past the line or what was
 * typed or deleted there, to the start after Home, ⌘←, an arrow across or a
 * click on the line below, and after ↑ or ↓ to the nearer of the two past the line it
 * left, as the browser's own caret goes. Drawn where the browser puts a
 * range, it went to the start of the next line every time.
 */
function wrapSide(
  view: EditorView,
  came: Came
): { side: -1 | 1; rect: Rect } | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const { $head } = selection;
  if (!$head.nodeBefore?.isText || !$head.nodeAfter?.isText) return null;
  const end = { side: -1 as const, rect: view.coordsAtPos($head.pos, -1) };
  const start = { side: 1 as const, rect: view.coordsAtPos($head.pos, 1) };
  const height = start.rect.bottom - start.rect.top;
  if (start.rect.top - end.rect.top < height / 2) return null;
  if ('side' in came) return came.side < 0 ? end : start;
  if ('typed' in came) return end;
  const top = view.dom.getBoundingClientRect().top;
  const at = 'y' in came ? came.y : came.line;
  const off = (wrap: typeof end | typeof start) => middle(wrap.rect, top) - at;
  if ('dir' in came) {
    const past = [end, start].filter((wrap) => off(wrap) * came.dir > 4);
    if (past.length === 1) return past[0];
  }
  return Math.abs(off(end)) <= Math.abs(off(start)) ? end : start;
}

/**
 * After a change, puts the browser's caret at the end of the line above
 * where the caret is drawn there, for ↑, ↓, Home and End to go on from the
 * line it is seen on. Typed at the end of a line, the letters went on there
 * and the browser had the caret at the start of the next line.
 */
function keepAtEnd(view: EditorView, came: Came) {
  if (wrapSide(view, came)?.side !== -1) return;
  const selection = view.dom.ownerDocument.getSelection();
  const node = selection?.focusNode;
  if (!selection?.isCollapsed || !node || !view.dom.contains(node)) return;
  const offset = selection.focusOffset;
  selection.modify('move', 'backward', 'character');
  selection.modify('move', 'forward', 'lineboundary');
  // The line ended elsewhere: back as it was.
  if (selection.focusNode !== node || selection.focusOffset !== offset) {
    selection.collapse(node, offset);
  }
}

function cursorRect(view: EditorView, toStart: boolean): Rect {
  const range = getSelection()?.getRangeAt(0)?.cloneRange();
  if (range) {
    range.collapse(toStart);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : null;
    if (rect?.height) return rect;
  }
  return view.coordsAtPos(view.state.selection.head);
}

/** -1 where code ends at the caret, 1 where it starts, otherwise 0. */
function codeEdge(before: Side, after: Side): -1 | 0 | 1 {
  const code = (side: Side) => side.some((mark) => mark.type.spec.code);
  if (code(before) === code(after)) return 0;
  return code(before) ? -1 : 1;
}

/**
 * Where the caret is drawn at the edge of code: against its text inside, past
 * its box outside. The two are one place in the DOM.
 */
function codeCaretX(
  view: EditorView,
  pos: number,
  edge: -1 | 1,
  inside: boolean
): number | null {
  if (inside) return view.coordsAtPos(pos, edge).left;
  const { node, offset } = view.domAtPos(pos, edge);
  const leaf =
    node.nodeType === Node.TEXT_NODE
      ? node
      : node.childNodes[edge < 0 ? offset - 1 : offset];
  const element = leaf instanceof Element ? leaf : leaf?.parentElement;
  const box = element?.closest('code')?.getBoundingClientRect();
  if (!box) return null;
  return edge < 0 ? box.right + 1 : box.left - 1;
}

/** The caret last drawn, for the selection it was drawn for, in the editor. */
let drawn: {
  view: EditorView;
  doc: ProseNode;
  head: number;
  left: number;
  top: number;
  bottom: number;
} | null = null;

/**
 * The caret as it is drawn, in the window: the row it is seen on, which at a
 * break in a wrapped line is not always the one its position measures to.
 */
export function caretBox(view: EditorView): Rect | null {
  const { doc, selection } = view.state;
  if (drawn?.view !== view || drawn.doc !== doc) return null;
  if (!selection.empty || drawn.head !== selection.head) return null;
  const box = view.dom.getBoundingClientRect();
  const left = box.left + drawn.left;
  return {
    left,
    right: left,
    top: box.top + drawn.top,
    bottom: box.top + drawn.bottom,
  };
}

const BLINK_AGAIN = 'ny-caret-blink-again';

/** Draws the caret; the middle of its height in the editor, if drawn. */
function drawCursor(
  view: EditorView,
  cursor: HTMLElement,
  came: Came
): number | null {
  if (view.isDestroyed) return null;
  const { state, dom } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  if (!getSelection()?.rangeCount) return null;
  const rect =
    wrapSide(view, came)?.rect ??
    cursorRect(view, selection.$head === selection.$from);
  const box = dom.getBoundingClientRect();
  let x = rect.left;
  const $pos = selection.$head;
  const [before, after] = marksAround($pos);
  const edge = selection.empty ? codeEdge(before, after) : 0;
  if (edge) {
    const inside = typedMarks(state, $pos).some((mark) => mark.type.spec.code);
    x = codeCaretX(view, $pos.pos, edge, inside) ?? x;
  }
  const again = cursor.classList.contains(BLINK_AGAIN) ? '' : ` ${BLINK_AGAIN}`;
  cursor.className = `prosemirror-virtual-cursor prosemirror-virtual-cursor-animation${again}`;
  cursor.style.height = `${rect.bottom - rect.top}px`;
  cursor.style.left = `${x - box.left}px`;
  cursor.style.top = `${rect.top - box.top}px`;
  drawn = {
    view,
    doc: state.doc,
    head: selection.head,
    left: x - box.left,
    top: rect.top - box.top,
    bottom: rect.bottom - box.top,
  };
  return middle(rect, box.top);
}

const MODIFIERS = new Set(['Shift', 'Meta', 'Alt', 'Control', 'CapsLock']);

/** How a key takes the caret, for `Came`; null for one that leaves it be. */
function cameBy(event: KeyboardEvent, line: number): Came | null {
  if (event.isComposing || MODIFIERS.has(event.key)) return null;
  const jump = jumpOf(event);
  if (jump) return { side: jump < 0 ? 1 : -1 };
  const bare = !event.metaKey && !event.ctrlKey;
  if (bare && event.key === 'ArrowUp') return { line, dir: -1 };
  if (bare && event.key === 'ArrowDown') return { line, dir: 1 };
  // ⌃E, the Mac's end of a line.
  if (event.ctrlKey && event.key === 'e') return { side: -1 };
  if (bare && (event.key.length === 1 || event.key === 'Backspace')) {
    return { typed: true };
  }
  return event.key === 'Delete' ? null : { side: 1 };
}

const key = new PluginKey('prosemirror-virtual-cursor');

/**
 * Marks `tr` as a click at `y` in the window that landed outside the text, for
 * the caret to be drawn on the side of a break in a wrapped line nearer it.
 */
export function clickedAt(tr: Transaction, view: EditorView, y: number) {
  const came: Came = { y: y - view.dom.getBoundingClientRect().top };
  return tr.setMeta(key, came);
}

export const markCursor = $prose(() => {
  const cursor = document.createElement('div');
  // The line edge the last key went to, until the selection gets there.
  let jump: -1 | 0 | 1 = 0;
  // While the paste event is handled, by whichever plugin takes it.
  let pasting = false;
  let came: Came = { side: 1 };
  // The middle of the caret last drawn, in the editor.
  let line = 0;
  return new Plugin({
    key,
    appendTransaction(trs, _old, state) {
      const click = trs.find((tr) => tr.getMeta(key))?.getMeta(key);
      if (click) {
        came = click;
        jump = 0;
      }
      if (pasting && trs.some((tr) => tr.docChanged)) {
        return outsideAfterPaste(state);
      }
      if (!jump || !trs.some((tr) => tr.selectionSet)) return null;
      const dir = jump;
      jump = 0;
      if (trs.some((tr) => tr.docChanged)) return null;
      return outsideAtEdge(state, dir);
    },
    view(view) {
      const draw = () => {
        line = drawCursor(view, cursor, came) ?? line;
      };
      const resize = new ResizeObserver(draw);
      resize.observe(view.dom);
      const doc = view.dom.ownerDocument;
      doc.addEventListener('selectionchange', draw);
      // A picture in a line takes its width once it loads, or once it fails
      // and shows its name, and a badge no taller than the line leaves the
      // editor's size as it was: the caret after one just typed stayed where
      // the picture began, over the text before it.
      const settle = () => requestAnimationFrame(draw);
      view.dom.addEventListener('load', settle, true);
      view.dom.addEventListener('error', settle, true);
      return {
        update(view, prev) {
          if (!prev.doc.eq(view.state.doc)) keepAtEnd(view, came);
          draw();
        },
        destroy() {
          doc.removeEventListener('selectionchange', draw);
          view.dom.removeEventListener('load', settle, true);
          view.dom.removeEventListener('error', settle, true);
          resize.disconnect();
        },
      };
    },
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          came = cameBy(event, line) ?? came;
          jump = jumpOf(event);
          // Already there, the caret does not move for it to follow.
          const tr = jump && outsideAtEdge(view.state, jump);
          if (tr) view.dispatch(tr);
          return false;
        },
        mousedown(view, event) {
          jump = 0;
          came = { y: event.clientY - view.dom.getBoundingClientRect().top };
          return false;
        },
        compositionend() {
          came = { typed: true };
          return false;
        },
        paste() {
          came = { typed: true };
          pasting = true;
          setTimeout(() => {
            pasting = false;
          });
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
          return false;
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return false;
        if (event.shiftKey || event.isComposing) return false;
        const tr = stepOver(view.state, event.key);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleClick(view, pos, event) {
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (event.detail > 1) return false;
        const $pos = view.state.doc.resolve(pos);
        if (!$pos.parent.inlineContent) return false;
        const side = clickedSide($pos, event.target as Element | null);
        if (!side) return false;
        const at = TextSelection.create(view.state.doc, pos);
        view.dispatch(view.state.tr.setSelection(at).setStoredMarks(side));
        return true;
      },
      decorations(state) {
        const { selection } = state;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return null;
        }
        return DecorationSet.create(state.doc, [
          Decoration.widget(0, cursor, { key: 'prosemirror-virtual-cursor' }),
        ]);
      },
      attributes: { class: 'virtual-cursor-enabled' },
    },
  });
});
