/**
 * A link to `#a-heading` leads to the heading GitHub and Typora give that
 * anchor: its text in lower case, the punctuation dropped, each space a
 * hyphen, and `-1`, `-2` after a name already taken. A table of contents
 * written for either reaches the same headings here.
 */

const DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/** The anchor of each heading in `texts`, taken in order. */
export function headingSlugs(texts: readonly string[]): string[] {
  const taken = new Map<string, number>();
  return texts.map((text) => {
    const base = text.toLowerCase().replace(DROPPED, '').replace(/ /g, '-');
    let slug = base;
    while (taken.has(slug)) {
      const count = (taken.get(base) ?? 0) + 1;
      taken.set(base, count);
      slug = `${base}-${count}`;
    }
    taken.set(slug, 0);
    return slug;
  });
}

/** Which of the headings in `texts` the link fragment names, or -1. */
export function anchorIndex(texts: readonly string[], fragment: string) {
  let name = fragment;
  try {
    name = decodeURIComponent(fragment);
  } catch {}
  return headingSlugs(texts).indexOf(name.toLowerCase());
}
