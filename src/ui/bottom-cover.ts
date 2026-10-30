/** How far up from the foot of the page the keyboard, or the native bar over it, reaches. */
let cover = 0;
const listeners = new Set<(cover: number) => void>();

export function bottomCover() {
  return cover;
}

export function setBottomCover(next: number) {
  if (next === cover) return;
  cover = next;
  for (const listener of listeners) listener(next);
}

export function onBottomCover(listener: (cover: number) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
