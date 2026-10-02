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

import { Mark, type ResolvedPos } from '@milkdown/kit/prose/model';
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
  const node = $pos.parent.maybeChild($pos.index());
  const onto =
    left && $pos.textOffset === 1
      ? $pos.pos - 1
      : !left && node && $pos.textOffset + 1 === node.nodeSize
        ? $pos.pos + 1
        : null;
  if (onto === null || !codeEdge(...marksAround(state.doc.resolve(onto)))) {
    return null;
  }
  const to = TextSelection.create(state.doc, onto);
  return state.tr.setSelection(to).setStoredMarks($pos.marks());
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

function cursorRect(view: EditorView, toStart: boolean) {
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

function drawCursor(view: EditorView, cursor: HTMLElement) {
  if (view.isDestroyed) return;
  const { state, dom } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return;
  if (!getSelection()?.rangeCount) return;
  const rect = cursorRect(view, selection.$head === selection.$from);
  const box = dom.getBoundingClientRect();
  let x = rect.left;
  const $pos = selection.$head;
  const [before, after] = marksAround($pos);
  const edge = selection.empty ? codeEdge(before, after) : 0;
  if (edge) {
    const inside = typedMarks(state, $pos).some((mark) => mark.type.spec.code);
    x = codeCaretX(view, $pos.pos, edge, inside) ?? x;
  }
  cursor.className = 'prosemirror-virtual-cursor';
  cursor.classList.remove('prosemirror-virtual-cursor-animation');
  void cursor.offsetWidth;
  cursor.classList.add('prosemirror-virtual-cursor-animation');
  cursor.style.height = `${rect.bottom - rect.top}px`;
  cursor.style.left = `${x - box.left}px`;
  cursor.style.top = `${rect.top - box.top}px`;
}

const key = new PluginKey('prosemirror-virtual-cursor');

export const markCursor = $prose(() => {
  const cursor = document.createElement('div');
  // The line edge the last key went to, until the selection gets there.
  let jump: -1 | 0 | 1 = 0;
  // While the paste event is handled, by whichever plugin takes it.
  let pasting = false;
  return new Plugin({
    key,
    appendTransaction(trs, _old, state) {
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
      const draw = () => drawCursor(view, cursor);
      const resize = new ResizeObserver(draw);
      resize.observe(view.dom);
      const doc = view.dom.ownerDocument;
      doc.addEventListener('selectionchange', draw);
      return {
        update: draw,
        destroy() {
          doc.removeEventListener('selectionchange', draw);
          resize.disconnect();
        },
      };
    },
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          jump = jumpOf(event);
          // Already there, the caret does not move for it to follow.
          const tr = jump && outsideAtEdge(view.state, jump);
          if (tr) view.dispatch(tr);
          return false;
        },
        mousedown() {
          jump = 0;
          return false;
        },
        paste() {
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
