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

/** A line that can start a link or footnote definition, `[label]:`. */
const DEFINES = /^ {0,3}\[.*\]:/;

/** A line holding nothing but spaces and tabs, which ends a paragraph. */
const BLANK = /^[ \t\r]*$/;

export type Parse = (markdown: string) => Root;

/**
 * The links and notes `rest` defines, each as written. The paragraphs with a
 * line that can start one are read by `parse`, those in a row together,
 * which takes the ones they define: a line under another of text is more of
 * it, as in the whole text.
 */
function definitionsIn(rest: string, parse: Parse): string[] {
  const found: string[] = [];
  let group: string[] = [];
  let paragraph: string[] = [];
  const readGroup = () => {
    const text = group.join('\n');
    group = [];
    if (!text) return;
    for (const block of parse(text).children) {
      if (block.type !== 'definition' && block.type !== 'footnoteDefinition') {
        continue;
      }
      const { start, end } = block.position ?? {};
      found.push(text.slice(start?.offset, end?.offset));
    }
  };
  const endParagraph = () => {
    if (paragraph.some((line) => DEFINES.test(line))) {
      group.push(...(group.length ? [''] : []), ...paragraph);
    } else if (paragraph.length) {
      readGroup();
    }
    paragraph = [];
  };
  for (const line of rest.split('\n')) {
    if (BLANK.test(line)) endParagraph();
    else paragraph.push(line);
  }
  endParagraph();
  readGroup();
  return found;
}

/**
 * The opening of `markdown`, up to the first block that starts past `size`
 * characters, or null when the text is short enough to draw at once. The
 * blocks are the ones `parse` reads in the text from the top, twice `size`
 * of it and more while no block starts past `size`: the blocks before one
 * read there are the ones the whole text starts with.
 *
 * The links and notes defined further down follow the opening, so that the
 * ones it uses read as they do in the whole text. Each paragraph they can be
 * in is read alone: one in a code block, a list or a quote reads otherwise
 * until the rest is drawn, which puts it right.
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
      const later = definitionsIn(markdown.slice(start), parse);
      return later.length ? `${opening}\n${later.join('\n\n')}\n` : opening;
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
