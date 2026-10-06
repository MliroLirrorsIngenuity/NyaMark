/**
 * The source pane reads formulas and front matter by the rules the editor
 * reads them with, remark-math's and remark-frontmatter's. Read as plain
 * Markdown, a `#` in a formula was a heading, a `*` in one emphasis, and the
 * metadata a file opens with a rule over a heading, which the scroll sync
 * then lined up with a heading in the preview.
 */

import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { LanguageSupport } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  type Extension,
  Text,
} from '@codemirror/state';
import { tags } from '@lezer/highlight';
import type {
  DelimiterType,
  InlineContext,
  Line,
  MarkdownConfig,
} from '@lezer/markdown';
import { isDollarText } from './plugins/math-dollars';

const DOLLAR = 36;
const BACKSLASH = 92;

/** The end of the run of dollars at `pos` in `text`. */
function runEnd(text: string, pos: number) {
  let end = pos;
  while (text.charCodeAt(end) === DOLLAR) end += 1;
  return end;
}

/** The end of the `$$` that opens a formula on `line`, or -1. */
function mathFence(line: Line) {
  if (line.next !== DOLLAR) return -1;
  const end = runEnd(line.text, line.pos);
  return end - line.pos >= 2 && !line.text.includes('$', end) ? end : -1;
}

/** Where the first run of exactly `size` dollars from `from` starts. */
function closingRun(cx: InlineContext, from: number, size: number, to: number) {
  for (let pos = from; pos < to; ) {
    if (cx.char(pos) !== DOLLAR) {
      pos += 1;
      continue;
    }
    const start = pos;
    while (cx.char(pos) === DOLLAR) pos += 1;
    if (pos - start === size) return start;
  }
  return null;
}

/** Dollars around text: the text is Markdown, and the dollars are kept. */
const DollarText: DelimiterType = {};

/** The end of the text between dollars `pos` is in, if it is in any. */
function dollarTextEnd(cx: InlineContext, pos: number) {
  let end: number | null = null;
  for (let i = cx.findOpeningDelimiter(DollarText) ?? -1; i >= 0; i -= 1) {
    const open = cx.getDelimiterAt(i);
    if (open?.type !== DollarText) continue;
    const close = closingRun(cx, open.to, open.to - open.from, cx.end);
    if (close !== null && close >= pos && (end === null || close < end)) {
      end = close;
    }
  }
  return end;
}

/** A formula's TeX as remark reads it: a padded one loses a space each end. */
function mathValue(between: string) {
  const padded =
    /^[ \n]/.test(between) && /[ \n]$/.test(between) && /[^ \n]/.test(between);
  return padded ? between.slice(1, -1) : between;
}

const math: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true },
    { name: 'InlineMath', style: tags.monospace },
    { name: 'MathMark', style: tags.processingInstruction },
    { name: 'MathText', style: tags.monospace },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      // Outside lists and quotes only: the parser's API has no way to tell
      // where those end on the lines a block takes. In one, a formula on
      // lines of its own is left as the text it was.
      parse(cx, line) {
        const fenceEnd = cx.depth === 1 ? mathFence(line) : -1;
        if (fenceEnd < 0) return false;
        const from = cx.lineStart + line.pos;
        const size = fenceEnd - line.pos;
        const parts = [cx.elt('MathMark', from, cx.lineStart + fenceEnd)];
        while (cx.nextLine()) {
          const end = line.indent < 4 ? runEnd(line.text, line.pos) : line.pos;
          if (
            end - line.pos >= size &&
            line.skipSpace(end) === line.text.length
          ) {
            parts.push(
              cx.elt('MathMark', cx.lineStart + line.pos, cx.lineStart + end)
            );
            cx.nextLine();
            break;
          }
          if (line.text) {
            parts.push(
              cx.elt('MathText', cx.lineStart, cx.lineStart + line.text.length)
            );
          }
        }
        cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), parts));
        return true;
      },
      endLeaf: (cx, line) => cx.depth === 1 && mathFence(line) >= 0,
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'InlineCode',
      parse(cx, next, start) {
        if (next !== DOLLAR) return -1;
        // A dollar after another opens nothing, unless that one is escaped.
        if (cx.char(start - 1) === DOLLAR) {
          let slashes = 0;
          while (cx.char(start - 2 - slashes) === BACKSLASH) slashes += 1;
          if (slashes % 2 === 0) return -1;
        }
        let size = 0;
        while (cx.char(start + size) === DOLLAR) size += 1;
        const within = dollarTextEnd(cx, start);
        if (within === start) return start + size;
        const close = closingRun(cx, start + size, size, within ?? cx.end);
        if (close === null) return -1;
        if (isDollarText(mathValue(cx.slice(start + size, close)))) {
          return cx.addDelimiter(DollarText, start, start + size, true, false);
        }
        return cx.addElement(
          cx.elt('InlineMath', start, close + size, [
            cx.elt('MathMark', start, start + size),
            cx.elt('MathMark', close, close + size),
          ])
        );
      },
    },
  ],
};

/** `-` for the line that opens or closes YAML, `+` for TOML. */
function frontMatterFence(text: string) {
  return /^(?:-{3}|\+{3})[ \t]*$/.test(text) ? text[0] : null;
}

/** Whether `doc` opens with front matter: a fence, and another to close it. */
export function opensWithFrontMatter(doc: Text): boolean {
  const fence = frontMatterFence(doc.line(1).text);
  if (!fence) return false;
  const lines = doc.iterLines(2);
  while (!lines.next().done) {
    if (frontMatterFence(lines.value) === fence) return true;
  }
  return false;
}

// Only in a document that opens with front matter: the parser reads on from
// the first line and cannot look ahead for the fence that closes it.
const frontMatter: MarkdownConfig = {
  defineNodes: [
    { name: 'FrontMatter', block: true },
    { name: 'FrontMatterMark', style: tags.processingInstruction },
    { name: 'FrontMatterText', style: tags.monospace },
  ],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        const fence = cx.lineStart === 0 ? frontMatterFence(line.text) : null;
        if (!fence) return false;
        const parts = [cx.elt('FrontMatterMark', 0, line.text.length)];
        while (cx.nextLine()) {
          const to = cx.lineStart + line.text.length;
          if (frontMatterFence(line.text) === fence) {
            parts.push(cx.elt('FrontMatterMark', cx.lineStart, to));
            cx.nextLine();
            break;
          }
          if (line.text) {
            parts.push(cx.elt('FrontMatterText', cx.lineStart, to));
          }
        }
        cx.addElement(cx.elt('FrontMatter', 0, cx.prevLineEnd(), parts));
        return true;
      },
    },
  ],
};

// GitHub's Markdown, as the file is read and written. Its sub- and
// superscripts are no part of it.
const github = { remove: ['Superscript', 'Subscript', 'Emoji'] };
let languages: { plain: LanguageSupport; withFrontMatter: LanguageSupport };
const language = new Compartment();

/** The source pane's Markdown, for a pane that opens on `doc`. */
export function sourceMarkdown(doc: string): Extension {
  // Made as the pane first opens, the app having opened without it.
  languages ??= {
    plain: markdown({ base: markdownLanguage, extensions: [math, github] }),
    withFrontMatter: markdown({
      base: markdownLanguage,
      extensions: [frontMatter, math, github],
    }),
  };
  const { plain, withFrontMatter } = languages;
  const opens = opensWithFrontMatter(Text.of(doc.split(/\r\n?|\n/)));
  return [
    language.of(opens ? withFrontMatter : plain),
    EditorState.transactionExtender.of((tr) => {
      if (!tr.docChanged) return null;
      const now = opensWithFrontMatter(tr.newDoc);
      if (now === (language.get(tr.startState) === withFrontMatter)) {
        return null;
      }
      return { effects: language.reconfigure(now ? withFrontMatter : plain) };
    }),
  ];
}
