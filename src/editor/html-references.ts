/**
 * The addresses written in a document's HTML, moved with it. Each attribute
 * that holds one is found where an HTML tokenizer reads it, and only its
 * value is written anew: the rest of the HTML stays as written. A tag
 * pattern had read `<img alt="a > b" src="img/x.png">` to end at the `>` in
 * its text, and the image stayed behind.
 */

import { escapeUTF8 } from 'entities';
import { Parser } from 'htmlparser2';
import parseSrcset from 'parse-srcset';

type Mapper = (reference: string) => string | null;

/** The attributes of each tag that hold an address the page loads or opens. */
const ADDRESSES: Record<string, readonly string[]> = {
  a: ['href'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
};

/** How `image` is written in a `srcset`. */
function writtenImage({
  url,
  w,
  h,
  d,
}: ReturnType<typeof parseSrcset>[number]) {
  return [url, w && `${w}w`, h && `${h}h`, d && `${d}x`]
    .filter(Boolean)
    .join(' ');
}

/**
 * `srcset` with the address of each image in it run through `mapper`,
 * written as the browser reads it; null when none moves, or when the list
 * written would not read back as those images at those addresses.
 */
function srcsetMapped(srcset: string, mapper: Mapper): string | null {
  const images = parseSrcset(srcset);
  const moved = images.map((image) => ({
    ...image,
    url: mapper(image.url) ?? image.url,
  }));
  if (moved.every((image, i) => image.url === images[i].url)) return null;
  const written = moved.map(writtenImage).join(', ');
  const read = parseSrcset(written);
  const same =
    read.length === moved.length &&
    read.every((image, i) => writtenImage(image) === writtenImage(moved[i]));
  return same ? written : null;
}

/**
 * `html` with the address of each image and link in it run through `mapper`;
 * an address it returns null for stays.
 */
export function htmlReferencesMapped(html: string, mapper: Mapper): string {
  const edits: { from: number; to: number; text: string }[] = [];
  let attributes: readonly string[] = [];
  let seen = new Set<string>();
  const parser = new Parser({
    onopentagname(name) {
      attributes = ADDRESSES[name] ?? [];
      seen = new Set();
    },
    onattribute(name, value, quote) {
      // The browser reads the first of an attribute written twice.
      if (!attributes.includes(name) || seen.has(name)) return;
      seen.add(name);
      if (!value) return;
      const next =
        name === 'srcset' ? srcsetMapped(value, mapper) : mapper(value);
      if (next === null || next === value) return;
      const from = parser.startIndex;
      const mark = quote === "'" ? "'" : '"';
      const written = html.slice(from, from + name.length);
      edits.push({
        from,
        to: parser.endIndex,
        text: `${written}=${mark}${escapeUTF8(next)}${mark}`,
      });
    },
  });
  parser.write(html);
  parser.end();
  let out = html;
  for (const { from, to, text } of edits.reverse()) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  return out;
}
