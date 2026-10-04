/**
 * A long document opens on its first screens. Drawn whole, every table,
 * code block and diagram of an article two thousand lines long was built
 * and laid out before the first line showed: the window stood empty for
 * seconds. The editor starts on the opening of the text, and the rest
 * follows once the first frame is on screen.
 *
 * Only the opening is read before that frame. Read whole, an article that
 * long held the first screen back as long again as drawing it did.
 *
 * The document stays closed to editing until it is all there, so that
 * nothing typed is taken for what the file held.
 */

/** Characters of Markdown drawn at once, a few screens of text. */
const OPENING_SIZE = 6000;

/** A fence of backticks, tildes or dollar signs, and what follows it. */
const FENCE = /^\s*(`{3,}|~{3,}|\${2,})(.*)$/;

/** A list item, which would go on with a list the opening ended. */
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;

/** A link or footnote defined on a line of its own. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm;

/**
 * The opening of `markdown`, up to the first block past `size` characters
 * that starts at the left margin after an empty line, or null when the text
 * is short enough to draw at once. Front matter, fenced code, math and HTML
 * comments are passed over whole: a line inside them starts no block.
 *
 * The links and notes defined further down follow the opening, so that the
 * ones it uses read as they do in the whole text. One defined over several
 * lines reads as written until the rest is drawn, which puts it right.
 */
export function openingOf(markdown: string, size = OPENING_SIZE) {
  if (markdown.length < size * 2) return null;
  /** What closes the block the line is in: a fence, `-->`, front matter. */
  let closer: ((line: string) => boolean) | null = null;
  let blank = false;
  let start = 0;
  if (/^---\r?\n/.test(markdown)) {
    closer = (line) => line === '---' || line === '...';
    start = markdown.indexOf('\n') + 1;
  }
  while (start < markdown.length) {
    const end = markdown.indexOf('\n', start);
    const next = end < 0 ? markdown.length : end + 1;
    const line = markdown.slice(start, end < 0 ? undefined : end).trimEnd();
    if (closer) {
      if (closer(line)) closer = null;
    } else if (
      start >= size &&
      blank &&
      /^\S/.test(line) &&
      !LIST_ITEM.test(line)
    ) {
      const opening = markdown.slice(0, start);
      const later = markdown.slice(start).match(DEFINITION);
      return later ? `${opening}${later.join('\n')}\n` : opening;
    } else {
      closer = opens(line);
    }
    blank = line.trim() === '';
    start = next;
  }
  return null;
}

/** What closes a block that `line` opens and that runs past empty lines. */
function opens(line: string): ((line: string) => boolean) | null {
  const fence = FENCE.exec(line);
  if (fence) {
    const [, marker = '', after = ''] = fence;
    const mark = marker.charAt(0);
    // Backticks and dollar signs on the line make it a span of code or a
    // formula, which ends where it starts.
    if (mark !== '~' && after.includes(mark)) return null;
    const close = new RegExp(`^\\s*\\${mark}{${marker.length},}\\s*$`);
    return (next) => close.test(next);
  }
  if (/^\s{0,3}<!--/.test(line) && !line.includes('-->')) {
    return (next) => next.includes('-->');
  }
  return null;
}

/**
 * Resolves once the opening is on screen. Drawn in parts, a frame apart,
 * each part laid the page out again: the whole took up to twice as long to
 * come in, and stayed closed to editing all that while.
 *
 * WebKit hands a frame to the screen after the next one has begun, so the
 * wait runs two frames: one frame on, the rest of the text held the opening
 * back for as long as it took to draw, a third of a second and more.
 */
export function afterFirstFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 0))
    );
  });
}
