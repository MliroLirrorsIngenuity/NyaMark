/**
 * A code block pasted from a web page keeps its language and ends with its
 * last line. Only the `data-language` this editor writes was read: the
 * `language-js` class GitHub, MDN and the highlighters put on a block was
 * lost, and the code came in without its colours. The line break a page ends
 * a `<pre>` with, which the page does not show, came in as an empty line at
 * the end of the block, and was saved with it.
 *
 * A block copied here is taken as it is, an empty last line and all.
 */

import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { Fragment } from '@milkdown/kit/prose/model';

/** `language-js`, `lang-js`, GitHub's `highlight-source-js`, MDN's `brush: js`. */
const LANGUAGE_CLASS =
  /(?:^|\s)(?:language|lang|highlight-source)-([\w#+.-]+)|(?:^|\s)brush:\s*([\w#+.-]+)/;

/** The language named by the first of `classes` that names one. */
export function languageFromClasses(classes: (string | null | undefined)[]) {
  for (const value of classes) {
    const match = LANGUAGE_CLASS.exec(value ?? '');
    if (match) return match[1] ?? match[2] ?? '';
  }
  return '';
}

type TextNode = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<TextNode>;
};

/** Elements a page puts each line of its code in. */
const LINE = /^(?:DIV|P|LI|TR)$/;

/** The code in a `<pre>`: a line break for each `<br>` and each line element. */
export function codeText(pre: TextNode): string {
  let text = '';
  const walk = (node: TextNode) => {
    if (node.nodeType === 3) {
      text += node.nodeValue ?? '';
      return;
    }
    if (node.nodeName === 'BR') {
      text += '\n';
      return;
    }
    if (LINE.test(node.nodeName) && text && !text.endsWith('\n')) {
      text += '\n';
    }
    Array.from(node.childNodes).forEach(walk);
  };
  Array.from(pre.childNodes).forEach(walk);
  return text.replace(/\r\n?/g, '\n');
}

/** Whether `dom` came from a ProseMirror editor, as a copy from this one does. */
function fromEditor(dom: Node) {
  let root: Node = dom;
  while (root.parentNode) root = root.parentNode;
  return !!(root as ParentNode).querySelector?.('[data-pm-slice]');
}

export const codeBlockFromHtml = codeBlockSchema.extendSchema(
  (prev) => (ctx) => {
    const schema = prev(ctx);
    return {
      ...schema,
      parseDOM: schema.parseDOM?.map((rule) => ({
        ...rule,
        getAttrs: (dom: HTMLElement) => {
          const attrs = rule.getAttrs?.(dom);
          if (attrs === false) return false;
          const language =
            dom.dataset.language ||
            dom.getAttribute('lang') ||
            languageFromClasses([
              dom.getAttribute('class'),
              dom.querySelector('code')?.getAttribute('class'),
              dom.parentElement?.getAttribute('class'),
            ]);
          return { ...attrs, language };
        },
        getContent: (dom, schema) => {
          let text = codeText(dom);
          if (!fromEditor(dom)) text = text.replace(/\n$/, '');
          return text ? Fragment.from(schema.text(text)) : Fragment.empty;
        },
      })),
    };
  }
);
