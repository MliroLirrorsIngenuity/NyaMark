/**
 * A long document opens on its first screens. Drawn whole, every table,
 * code block and diagram of an article two thousand lines long was built
 * and laid out before the first line showed: the window stood empty for
 * seconds. The editor starts on the opening of the text, and the rest
 * follows once the first frame is on screen.
 *
 * Only the opening, and as much again, is read before that frame. Read
 * whole, an article that long held the first screen back as long again as
 * drawing it did.
 *
 * The document stays closed to editing until it is all there, so that
 * nothing typed is taken for what the file held.
 */

import {
  ParserReady,
  defaultValueCtx,
  editorStateTimerCtx,
  remarkCtx,
} from '@milkdown/kit/core';
import { type MilkdownPlugin, createTimer } from '@milkdown/kit/ctx';
import type { Root } from 'mdast';

/** Characters of Markdown drawn at once, a few screens of text. */
const OPENING_SIZE = 6000;

/** A link or footnote defined on a line of its own. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gm;

export type Parse = (markdown: string) => Root;

/**
 * The opening of `markdown`, up to the first block that starts past `size`
 * characters, or null when the text is short enough to draw at once. The
 * blocks are the ones `parse` reads in the text from the top, twice `size`
 * of it and more while no block starts past `size`: the blocks before one
 * read there are the ones the whole text starts with.
 *
 * The links and notes defined further down follow the opening, so that the
 * ones it uses read as they do in the whole text. Their lines are looked for
 * in the rest unread: one in a code block or over several lines reads
 * otherwise until the rest is drawn, which puts it right.
 */
export function openingOf(
  markdown: string,
  parse: Parse,
  size = OPENING_SIZE
): string | null {
  if (markdown.length < size * 2) return null;
  for (let read = size * 2; ; read *= 2) {
    // Whole lines: a line cut short can read as more of the block above it.
    const lineEnd = markdown.indexOf('\n', read);
    const end = lineEnd < 0 ? markdown.length : lineEnd + 1;
    const [, ...blocks] = parse(markdown.slice(0, end)).children;
    const from = blocks
      .map((block) => block.position?.start.offset ?? 0)
      .find((offset) => offset >= size);
    if (from !== undefined) {
      const start = markdown.lastIndexOf('\n', from - 1) + 1;
      const opening = markdown.slice(0, start);
      const later = markdown.slice(start).match(DEFINITION);
      return later ? `${opening}${later.join('\n')}\n` : opening;
    }
    if (end === markdown.length) return null;
  }
}

/** Done once the editor's text is cut to its opening. */
const OpeningReady = createTimer('NyamarkOpeningReady');

/**
 * Starts the editor on the opening of the text it is given, read by the
 * editor's own remark, and tells `opened` that opening, or null for the
 * whole text.
 */
export function openInParts(
  opened: (opening: string | null) => void
): MilkdownPlugin {
  return (ctx) => {
    ctx.record(OpeningReady);
    ctx.update(editorStateTimerCtx, (timers) => [...timers, OpeningReady]);
    return async () => {
      await ctx.wait(ParserReady);
      const markdown = ctx.get(defaultValueCtx);
      const remark = ctx.get(remarkCtx);
      const opening =
        typeof markdown === 'string'
          ? openingOf(markdown, (text) => remark.parse(text))
          : null;
      if (opening !== null) ctx.set(defaultValueCtx, opening);
      opened(opening);
      ctx.done(OpeningReady);
      return () => {
        ctx.update(editorStateTimerCtx, (timers) =>
          timers.filter((timer) => timer !== OpeningReady)
        );
        ctx.clearTimer(OpeningReady);
      };
    };
  };
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
