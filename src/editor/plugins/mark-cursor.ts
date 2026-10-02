/**
 * The caret at the edge of a mark, drawn on the side typing goes to. Adapted
 * from prosemirror-virtual-cursor (MIT, ocavue), which Crepe uses and which
 * knows an edge only between two runs of text.
 *
 * At the end of a line ending in inline code nothing comes after the code, so
 * → went on to the next line and all that was typed at the end went into the
 * code: `npm install` took the X typed after it as `npm installX`. A link at
 * the end of a line took in what came after it the same way, and so did a
 * mark opening a line for what was typed in front of it. Here the start and
 * the end of a block count as text with no marks: → at the end of a line
 * steps out of its marks before it moves on, ← at the start of one does the
 * same, and the caret shows the side it is on.
 *
 * Code and links show where they end, and the caret goes by that. A click
 * past the end of one puts the caret outside it, as ⌘→ or End to the end of
 * the line does, and a click on its text puts it inside. A paste that ends in
 * one leaves the caret outside it too: the space typed after a pasted address
 * went into its link. Outside code, the caret is drawn past its box.
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
 * ← or → at an edge goes over to the other side of it first. Moving onto an
 * edge over a character keeps the marks of that character, so the caret
 * lands on the side it came from.
 */
export function stepOver(state: EditorState, key: string): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const left = key === 'ArrowLeft';
  const $pos = selection.$head;
  const [before, after] = marksAround($pos);
  if (!Mark.sameSet(before, after)) {
    const side = left ? before : after;
    if (!Mark.sameSet(side, typedMarks(state, $pos))) {
      return state.tr.setStoredMarks(side);
    }
  }
  const node = $pos.parent.maybeChild($pos.index());
  if (left && $pos.textOffset === 1) {
    const to = TextSelection.create(state.doc, $pos.pos - 1);
    return state.tr.setSelection(to).setStoredMarks($pos.marks());
  }
  if (!left && node && $pos.textOffset + 1 === node.nodeSize) {
    const to = TextSelection.create(state.doc, $pos.pos + 1);
    return state.tr.setSelection(to).setStoredMarks($pos.marks());
  }
  return null;
}

/** Marks whose box or underline shows where they end. */
const drawn = (mark: Mark) =>
  mark.type.spec.code ? 'code' : mark.type.name === 'link' ? 'a' : null;

/**
 * The marks for a click at `pos`, when it is at the edge of code or a link:
 * those of the side clicked on.
 */
export function clickedSide(
  $pos: ResolvedPos,
  target: Element | null
): Side | null {
  const [before, after] = marksAround($pos);
  if (Mark.sameSet(before, after)) return null;
  const edge = [...before, ...after].find(
    (mark) => drawn(mark) && !!mark.isInSet(before) !== !!mark.isInSet(after)
  );
  const tag = edge && drawn(edge);
  if (!edge || !tag) return null;
  const inside = !!target?.closest(tag);
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
 * outside the code or the link there, as a click past it does.
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
  if (!inner.some(drawn)) return null;
  return state.tr.setStoredMarks(Mark.none);
}

/** The caret right after code or a link just pasted, outside it. */
export function outsideAfterPaste(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const [before, after] = marksAround(selection.$head);
  const ending = before.filter((mark) => drawn(mark) && !mark.isInSet(after));
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
  let className = 'prosemirror-virtual-cursor';
  let x = rect.left;
  const $pos = selection.$head;
  const [before, after] = marksAround($pos);
  if (selection.empty && !Mark.sameSet(before, after)) {
    const marks = typedMarks(state, $pos);
    if (Mark.sameSet(before, marks)) {
      className += ' prosemirror-virtual-cursor-left';
    } else if (Mark.sameSet(after, marks)) {
      className += ' prosemirror-virtual-cursor-right';
    }
    const edge = codeEdge(before, after);
    const inside = marks.some((mark) => mark.type.spec.code);
    if (edge) x = codeCaretX(view, $pos.pos, edge, inside) ?? x;
  }
  cursor.className = className;
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
