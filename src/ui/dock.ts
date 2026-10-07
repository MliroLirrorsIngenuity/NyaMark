/**
 * Opens and closes the cards docked beside the document: the outline and
 * the assistant. Opening, the document makes room at once and the card slides
 * into it; closing, the card slides out first and the document takes its room
 * back after, so the two never overlap. A card docked beside it slides to its
 * new place. The document itself moves in one step: moved on every frame, a
 * long document would be laid out again on each.
 */

import type { EditorView } from 'prosemirror-view';
import { animationsSettled } from './modal';
import { keepReadingPosition } from './reading-position';

/** The close under way for each card, which opening it again calls off. */
const closing = new WeakMap<HTMLElement, symbol>();

/**
 * Shows or hides `card`, and with it `roomClass` on the page: the class that
 * makes the document room for the card.
 */
export function setDocked(
  card: HTMLElement,
  open: boolean,
  roomClass: string,
  view: EditorView | null
) {
  if (!open) {
    void leave(card, roomClass, view);
    return;
  }
  closing.delete(card);
  card.classList.remove('is-closing');
  rearrange(card, view, () => {
    card.hidden = false;
    document.documentElement.classList.add(roomClass);
  });
}

async function leave(
  card: HTMLElement,
  roomClass: string,
  view: EditorView | null
) {
  const token = Symbol();
  closing.set(card, token);
  card.classList.add('is-closing');
  await animationsSettled(card);
  if (closing.get(card) !== token) return;
  closing.delete(card);
  card.classList.remove('is-closing');
  rearrange(card, view, () => {
    card.hidden = true;
    document.documentElement.classList.remove(roomClass);
  });
}

/**
 * Runs `change`, which moves `card` in or out of the dock, keeping the line
 * being read in place and sliding the other docked cards to where it puts
 * them.
 */
function rearrange(
  card: HTMLElement,
  view: EditorView | null,
  change: () => void
) {
  const others = [
    ...document.querySelectorAll<HTMLElement>('.ny-dock:not([hidden])'),
  ].filter((other) => other !== card);
  const before = others.map((other) => other.getBoundingClientRect().left);
  keepReadingPosition(view, change);
  for (const [index, other] of others.entries()) {
    const shift = (before[index] ?? 0) - other.getBoundingClientRect().left;
    if (shift !== 0) slide(other, shift);
  }
}

/** Puts `card` back where it was, `shift` px off, and lets it slide home. */
function slide(card: HTMLElement, shift: number) {
  card.style.transition = 'none';
  card.style.transform = `translateX(${shift}px)`;
  // Drawn where it was first, or there is nothing to slide from.
  card.getBoundingClientRect();
  card.style.removeProperty('transition');
  card.style.removeProperty('transform');
}
