/**
 * The YAML (or TOML) a file opens with between `---` (or `+++`) lines stays
 * front matter. Read as Markdown, its opening `---` was a rule and the lines
 * under it a heading underlined by the closing one: the first save wrote
 * them back as a heading, its brackets escaped, and the metadata Hugo,
 * Jekyll, Obsidian and the attachment folder setting read from it was gone.
 *
 * It shows as a code block in its language at the top of the page, and is
 * written back between its fences while it still opens the file in that
 * language. Moved below anything else, or given another language, it is
 * saved as the code block it then is.
 */

import { Selection, type Transaction } from '@milkdown/kit/prose/state';
import type { NodeSchema } from '@milkdown/kit/transformer';
import { $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';
import { codeBlockFromHtml } from './code-block-html';

const KINDS = ['yaml', 'toml'] as const;
type Kind = (typeof KINDS)[number];

const isKind = (type: unknown): type is Kind => KINDS.includes(type as Kind);

/** Parses front matter into `yaml` and `toml` nodes, and writes them back. */
export const frontMatterSyntax = $remark(
  'nyamark-front-matter',
  () => remarkFrontmatter,
  [...KINDS]
);

/** The code block schema `schema`, front matter read into it and out of it. */
export function withFrontMatter(schema: NodeSchema): NodeSchema {
  const { parseMarkdown, toMarkdown } = schema;
  return {
    ...schema,
    attrs: { ...schema.attrs, frontMatter: { default: '' } },
    parseMarkdown: {
      match: (node) => isKind(node.type) || parseMarkdown.match(node),
      runner: (state, node, type) => {
        if (!isKind(node.type)) return parseMarkdown.runner(state, node, type);
        state.openNode(type, { language: node.type, frontMatter: node.type });
        if (node.value) state.addText(String(node.value));
        state.closeNode();
      },
    },
    toMarkdown: {
      ...toMarkdown,
      runner: (state, node) => {
        const kind = node.attrs.frontMatter;
        if (!isKind(kind) || node.attrs.language !== kind) {
          return toMarkdown.runner(state, node);
        }
        state.addNode(kind, undefined, node.textContent);
      },
    },
  };
}

type MdNode = {
  type: string;
  value?: string;
  lang?: string;
  children?: MdNode[];
};

/**
 * `tree` with front matter anywhere but at the very top written as a code
 * block: its fences there would read as rules and headings.
 */
export function frontMatterOnTop<T extends MdNode>(tree: T): T {
  const visit = (node: MdNode, top: boolean) => {
    (node.children ?? []).forEach((child, index) => {
      if (isKind(child.type) && !(top && index === 0)) {
        child.lang = child.type;
        child.type = 'code';
      }
      visit(child, false);
    });
  };
  visit(tree, true);
  return tree;
}

/**
 * `tr` with the caret past the front matter a file opens with, on the first
 * line of its text: it started in the metadata, and typing went there.
 */
export function pastFrontMatter(tr: Transaction): Transaction {
  const first = tr.doc.firstChild;
  if (!first?.attrs.frontMatter || tr.doc.childCount < 2) return tr;
  return tr.setSelection(Selection.near(tr.doc.resolve(first.nodeSize)));
}

/** The code block, front matter read into it and out of it. */
export const frontMatterBlock = codeBlockFromHtml.extendSchema(
  (prev) => (ctx) => withFrontMatter(prev(ctx))
);
