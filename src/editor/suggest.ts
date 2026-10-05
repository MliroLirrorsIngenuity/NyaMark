/**
 * Between the editors and the suggestions while writing: the editor and the
 * source pane tell the driver when the user typed or moved the caret, and
 * it tells them what to show. The driver loads with the assistant, once the
 * user turns suggestions on; until then nothing listens.
 */

/** Where the caret is, as a suggestion would carry on from it. */
export type SuggestSpot = {
  /** The text before the caret, and after it, as far as is cheap to read. */
  before: string;
  after: string;
  /** The caret's paragraph, or its line in the source, up to the caret. */
  line: string;
  /** Only white space follows the caret in its paragraph or line. */
  atEnd: boolean;
  /** Markdown as typed, in the source pane; the text shown, in the editor. */
  markdown: boolean;
  /** Shows `text` at the caret, unless it moved or the text changed since. */
  show(text: string): void;
};

export type SuggestDriver = {
  /**
   * The user typed, or only moved the caret. `spot` reads where the caret
   * is when called, null where no suggestion goes.
   */
  changed(spot: () => SuggestSpot | null, typed: boolean): void;
  /** The caret left the text: what is waiting or asked for is dropped. */
  stop(): void;
};

let driver: SuggestDriver | null = null;

export function setSuggestDriver(next: SuggestDriver | null) {
  if (driver !== next) driver?.stop();
  driver = next;
}

export function suggestDriver(): SuggestDriver | null {
  return driver;
}

/** How much of the text either side of the caret a spot reads. */
export const SPOT_BEFORE = 4000;
export const SPOT_AFTER = 1000;

type WordSegmenter = {
  segment(text: string): Iterable<{ segment: string; index: number }>;
};

/** `Intl.Segmenter`, which the TypeScript library targeted leaves out. */
const Segmenter = (
  Intl as unknown as {
    Segmenter?: new (
      locale: undefined,
      options: { granularity: 'word' }
    ) => WordSegmenter;
  }
).Segmenter;

let words: WordSegmenter | null = null;

/** A run of letters, or one mark that is no letter, where words go unsplit. */
const ROUGH_WORD = /^\s*(?:[\p{L}\p{N}\p{M}_]+|[^\s])/u;

/**
 * The start of `text` up to the end of its first word, or of its first mark
 * that is no word: what Mod-→ takes of a suggestion. Words run by the rules
 * of their script, so in Chinese a word is what the dictionary finds.
 */
export function nextWord(text: string): string {
  if (!Segmenter) return ROUGH_WORD.exec(text)?.[0] ?? text;
  words ??= new Segmenter(undefined, { granularity: 'word' });
  for (const { segment, index } of words.segment(text)) {
    if (segment.trim()) return text.slice(0, index + segment.length);
  }
  return text;
}

/** The grey text of a suggestion, in the editor and the source pane alike. */
export const suggestStyles = `
.ny-ai-suggest {
  color: var(--ny-text-muted);
  opacity: 0.75;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

@media print {
  .ny-ai-suggest {
    display: none;
  }
}
`;
