/**
 * A list pasted from Word stays a list. Word writes each item as a paragraph
 * of its own, its level in the style and its bullet or number as text, so
 * the list came in as paragraphs that each opened with `·` and a run of
 * spaces. The items are put back into lists, nested by their levels, and the
 * bullets and numbers Word wrote out are left behind.
 *
 * A heading Word numbers keeps its number: it stays a heading.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const LEVEL = /mso-list:\s*l\d+\s+level(\d+)/i;
const MARKER = /mso-list:\s*ignore/i;

/** The level of the list item Word wrote with `style`, from 1. */
export function wordListLevel(style: string | null): number | null {
  const match = style && LEVEL.exec(style);
  return match ? Number(match[1]) : null;
}

/** Whether Word numbered an item with `marker`: `1.`, `a)`, `(iv)`. */
export function isNumberMarker(marker: string): boolean {
  return /^\(?[0-9a-z]{1,4}[.)]$/i.test(marker.replace(/[\s ]/g, ''));
}

/** The element after `node`, past the space and comments between. */
function nextElement(node: Node): Element | null {
  for (let next = node.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType === Node.ELEMENT_NODE) return next as Element;
    if (next.nodeType === Node.TEXT_NODE && next.textContent?.trim()) {
      return null;
    }
  }
  return null;
}

/** Puts the items Word wrote as paragraphs in `body` into lists. */
export function listsFromWord(body: HTMLElement) {
  const doc = body.ownerDocument;
  const items = [...body.querySelectorAll('p[style*="mso-list"]')].filter(
    (item) => wordListLevel(item.getAttribute('style')) !== null
  );
  const follows = items.map(
    (item, i) => i > 0 && nextElement(items[i - 1]) === item
  );
  let open: { list: Element; level: number }[] = [];
  items.forEach((item, i) => {
    if (!follows[i]) open = [];
    const level = wordListLevel(item.getAttribute('style')) ?? 1;
    const marker = [...item.querySelectorAll('span')].find((span) =>
      MARKER.test(span.getAttribute('style') ?? '')
    );
    const tag =
      marker && isNumberMarker(marker.textContent ?? '') ? 'OL' : 'UL';
    marker?.remove();
    while (open.length > 0) {
      const last = open[open.length - 1];
      if (last.level < level) break;
      if (last.level === level && last.list.tagName === tag) break;
      open.pop();
    }
    let last = open[open.length - 1];
    if (!last || last.level < level) {
      const list = doc.createElement(tag);
      if (last) (last.list.lastElementChild ?? last.list).append(list);
      else item.before(list);
      last = { list, level };
      open.push(last);
    }
    const line = doc.createElement('p');
    line.append(...item.childNodes);
    const entry = doc.createElement('li');
    entry.append(line);
    last.list.append(entry);
    item.remove();
  });
}

export const pasteWordLists = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/paste-word-lists'),
      props: {
        transformPastedHTML(html) {
          if (!LEVEL.test(html)) return html;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          listsFromWord(doc.body);
          return doc.body.innerHTML;
        },
      },
    })
);
