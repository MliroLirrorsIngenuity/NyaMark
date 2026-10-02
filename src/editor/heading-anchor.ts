/**
 * A link to `#a-heading` leads to the heading GitHub and Typora give that
 * anchor: its text in lower case, the punctuation dropped, each space a
 * hyphen, and `-1`, `-2` after a name already taken. A table of contents
 * written for either reaches the same headings here.
 */

import type { Node } from '@milkdown/kit/prose/model';

const DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/**
 * A heading's text as the outline shows it, a formula by its TeX and an image
 * by its alt text. A heading of a formula or a logo alone has no other text:
 * it stood in the outline as an empty line, with no id to go to.
 */
export function headingLabel(heading: Node): string {
  return heading
    .textBetween(0, heading.content.size, undefined, (leaf) =>
      String(leaf.attrs.value ?? leaf.attrs.alt ?? ' ')
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Milkdown's id for a heading, made from its label when it has no text. */
export function headingId(heading: Node): string {
  const text = heading.textContent.trim()
    ? heading.textContent
    : headingLabel(heading);
  return text.toLowerCase().trim().replace(/\s+/g, '-');
}

/** The id a heading has on the page, which Milkdown sets for text alone. */
export const pageId = (heading: Node): string =>
  String(heading.attrs.id || headingId(heading));

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
