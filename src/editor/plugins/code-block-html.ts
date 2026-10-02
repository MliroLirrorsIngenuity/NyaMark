/**
 * A code block pasted from a web page keeps its language and ends with its
 * last line. Only the `data-language` this editor writes was read: the
 * `language-js` class GitHub, MDN and the highlighters put on a block was
 * lost, and the code came in without its colours. The line break a page ends
 * a `<pre>` with, which the page does not show, came in as an empty line at
 * the end of the block, and was saved with it.
 *
 * A block copied here is taken as it is, an empty last line and all.
 *
 * A formula is saved between `$$` lines. Crepe writes it so in its own take on
 * the code block, and this one, built on the plain code block, took its place:
 * once a file was edited, each of its formulas was saved as a ```` ```LaTeX ````
 * code block.
 *
 * What a fence names after the language stays with the block: the
 * `title="app.js"` or `{1,3}` other sites draw a file name or marked lines
 * from was lost at the first save.
 */

import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { type DOMOutputSpec, Fragment } from '@milkdown/kit/prose/model';
import type { NodeSchema } from '@milkdown/kit/transformer';

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

type Runner = NodeSchema['toMarkdown']['runner'];

/** `write` for a code block, with a formula written between `$$` lines. */
export function formulaAsMath(write: Runner): Runner {
  return (state, node) => {
    const language = String(node.attrs.language ?? '').toLowerCase();
    if (language !== 'latex') return write(state, node);
    state.addNode('math', undefined, node.textContent);
  };
}

/** `write` for a code block, its language and what the fence names after. */
export const writeCode: Runner = (state, node) => {
  state.addNode('code', undefined, node.textContent, {
    lang: node.attrs.language,
    meta: node.attrs.meta || undefined,
  });
};

export const codeBlockFromHtml = codeBlockSchema.extendSchema(
  (prev) => (ctx) => {
    const schema = prev(ctx);
    return {
      ...schema,
      attrs: { ...schema.attrs, meta: { default: '', validate: 'string' } },
      toDOM: (node) => {
        const dom = schema.toDOM?.(node);
        const { meta } = node.attrs;
        if (!meta || !Array.isArray(dom)) return dom as DOMOutputSpec;
        const [tag, attrs, ...rest] = dom;
        return [tag, { ...attrs, 'data-meta': meta }, ...rest];
      },
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
          const meta = dom.dataset.meta ?? '';
          return { ...attrs, language, meta };
        },
        getContent: (dom, schema) => {
          let text = codeText(dom);
          if (!fromEditor(dom)) text = text.replace(/\n$/, '');
          return text ? Fragment.from(schema.text(text)) : Fragment.empty;
        },
      })),
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner: (state, node, type) => {
          state.openNode(type, {
            language: node.lang ?? '',
            meta: node.meta ?? '',
          });
          if (node.value) state.addText(String(node.value));
          state.closeNode();
        },
      },
      toMarkdown: {
        ...schema.toMarkdown,
        runner: formulaAsMath(writeCode),
      },
    };
  }
);
