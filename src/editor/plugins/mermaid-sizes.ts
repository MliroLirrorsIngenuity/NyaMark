/* The size each diagram was last drawn at, kept across launches for its placeholder to hold. */

const STORAGE_KEY = 'nyamark.mermaidSizes';
/** How many diagrams' sizes are kept, the last drawn. */
const KEPT_SIZES = 200;

type Size = [width: number, height: number];

let sizes: Map<string, Size> | null = null;

function kept(): Map<string, Size> {
  if (sizes) return sizes;
  sizes = new Map();
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    );
    if (Array.isArray(stored)) {
      for (const [key, size] of stored) sizes.set(key, size);
    }
  } catch {
    // None are kept.
  }
  return sizes;
}

/** The size the diagram `key` names was last drawn at. */
export function drawnSize(key: string): Size | undefined {
  return kept().get(key);
}

/** Keeps the size the diagram `key` names was drawn at. */
export function keepDrawnSize(key: string, width: number, height: number) {
  const all = kept();
  const old = all.get(key);
  if (old?.[0] === width && old[1] === height) return;
  all.delete(key);
  all.set(key, [width, height]);
  for (const oldest of all.keys()) {
    if (all.size <= KEPT_SIZES) break;
    all.delete(oldest);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...all]));
  } catch {
    // Kept until the page goes.
  }
}
