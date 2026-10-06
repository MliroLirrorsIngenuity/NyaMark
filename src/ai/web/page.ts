/**
 * A fetched page as the assistant reads it: the article in it, as Markdown,
 * with its links made whole. The HTML is parsed into a document that is
 * never shown, so nothing in it runs or loads.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { WebPage } from '../../bridge/ipc/ai';

export type PageText = {
  title: string;
  /** The page as Markdown, or its text as it came when it is not HTML. */
  text: string;
};

export type HtmlParser = (html: string) => Document;

const parseHtml: HtmlParser = (html) =>
  new DOMParser().parseFromString(html, 'text/html');

/** What a reader never wants, when the page is read whole. */
const NOISE =
  'script, style, noscript, template, iframe, object, embed, svg, canvas, form, nav, footer, aside, dialog';

/** Shorter than this, what Readability found is no article. */
const MIN_ARTICLE_CHARS = 200;
/** Past this, an article is taken however much else the page has. */
const LONG_ARTICLE_CHARS = 2000;

const essence = (type: string) => type.split(';')[0].trim().toLowerCase();

const textLength = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim().length;

function isHtml(page: Pick<WebPage, 'contentType' | 'text'>) {
  const type = essence(page.contentType);
  if (type === 'text/html' || type === 'application/xhtml+xml') return true;
  return (
    type === 'text/plain' && /^\s*<(!doctype html|html)\b/i.test(page.text)
  );
}

/** Links and images point where the page meant, not into the app. */
function absolutize(doc: Document, base: string) {
  const attributes = [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ] as const;
  for (const [selector, attribute] of attributes) {
    for (const element of doc.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute) ?? '';
      let resolved: URL | null = null;
      try {
        resolved = new URL(value, base);
      } catch {
        resolved = null;
      }
      if (resolved && /^(https?|mailto):$/.test(resolved.protocol)) {
        element.setAttribute(attribute, resolved.href);
      } else {
        element.removeAttribute(attribute);
      }
    }
  }
}

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  service.remove(['script', 'style', 'noscript', 'template']);
  // Tables as GitHub's pipe tables, the first row taken as the header.
  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const first = !(node as Element).previousElementSibling;
      const cell = content
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
      return `${first ? '| ' : ' '}${cell} |`;
    },
  });
  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content) => `\n${content}\n`,
  });
  service.addRule('table', {
    filter: 'table',
    replacement: (content) => {
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const rows = lines.filter((line) => line.startsWith('|'));
      const caption = lines.filter((line) => !line.startsWith('|')).join(' ');
      if (rows.length === 0) return caption ? `\n\n${caption}\n\n` : '';
      // Each cell ends in a bar; bars in the text are escaped.
      let columns = 1;
      for (const row of rows) {
        columns = Math.max(columns, (row.match(/(?<!\\)\|/g)?.length ?? 2) - 1);
      }
      const rule = `|${' --- |'.repeat(columns)}`;
      const table = [rows[0], rule, ...rows.slice(1)].join('\n');
      return `\n\n${caption ? `${caption}\n\n` : ''}${table}\n\n`;
    },
  });
  return service;
}

// Turndown joins blocks with one blank line and trims the ends already;
// a line's trailing spaces are a hard break and code keeps its blank lines.
const markdown = (html: string) => turndown().turndown(html);

function htmlText(html: string, url: string, parse: HtmlParser): PageText {
  const doc = parse(html);
  absolutize(doc, url);
  const title = (doc.title ?? '').trim();
  const article = new Readability(doc.cloneNode(true) as Document, {
    charThreshold: 300,
  }).parse();
  for (const element of doc.querySelectorAll(NOISE)) element.remove();
  const body = doc.body;
  const articleLength = textLength(article?.textContent);
  const bodyLength = textLength(body?.textContent);
  // An article found in a page of much else, such as a list of posts, is
  // only one of them; the page is read whole instead.
  const isArticle =
    article?.content &&
    articleLength >= MIN_ARTICLE_CHARS &&
    (articleLength >= LONG_ARTICLE_CHARS || articleLength * 5 >= bodyLength);
  if (isArticle) {
    return {
      title: (article.title ?? '').trim() || title,
      text: markdown(article.content ?? ''),
    };
  }
  return { title, text: markdown(body?.innerHTML ?? '') };
}

function jsonText(text: string) {
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``;
  } catch {
    return text.trim();
  }
}

/** The page's text as the assistant reads it. */
export function pageText(
  page: Pick<WebPage, 'url' | 'contentType' | 'text'>,
  parse: HtmlParser = parseHtml
): PageText {
  if (isHtml(page)) return htmlText(page.text, page.url, parse);
  const type = essence(page.contentType);
  if (type === 'application/json' || type.endsWith('+json')) {
    return { title: '', text: jsonText(page.text) };
  }
  return { title: '', text: page.text.trim() };
}
