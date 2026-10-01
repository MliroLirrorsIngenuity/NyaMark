/**
 * A link written bare stays bare through a save. GFM reads `https://…`,
 * `www.…` and an email address in text as links, and remark wrote each back
 * in a shape of its own: `<https://…>`, `[www.…](http://www.…)` and
 * `<me@…>`. Every bare link in a file changed the first time it was saved.
 *
 * A link read from bare text is marked as it is parsed, and written back as
 * its text while that still reads as the same link: its text and address as
 * they were, and nothing against either end that a reader would take into
 * it or that would keep it from being read. A link written any other way,
 * or one whose text or address was edited, is written the way remark writes
 * it.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { linkSchema } from '@milkdown/kit/preset/commonmark';
import { $remark } from '@milkdown/kit/utils';
import { type Handle, defaultHandlers } from 'mdast-util-to-markdown';

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  data?: { bare?: boolean };
  position?: { start?: { offset?: number } };
  children?: MdNode[];
};

// What GFM leaves out of the end of a bare link when nothing but space
// follows (`micromark-extension-gfm-autolink-literal`).
const TRAIL = /^[!"&')*,.:;?\]_~]$/;
const ENDS = /^[\s<]?$/;

/** How the text of a bare link reads as `url`, or null when it does not. */
function bareKind(text: string, url: string) {
  if (url === text && /^https?:\/\//i.test(text)) return 'protocol';
  if (url === `http://${text}` && /^www\./i.test(text)) return 'www';
  if (url === `mailto:${text}` && text.includes('@')) return 'email';
  return null;
}

/** Whether a reader takes a link of `kind` to begin after `before`. */
function beginsAfter(kind: string, before: string) {
  if (kind === 'protocol') return !/[A-Za-z]/.test(before);
  if (kind === 'www') return before === '' || /[\s(*_[\]~]/.test(before);
  return !/[/+\-._A-Za-z0-9]/.test(before);
}

/** The text `node` is written as, bare, or null when it must be spelt out. */
export function bareLinkText(
  node: MdNode,
  before: string,
  after: string
): string | null {
  const [child, ...rest] = node.children ?? [];
  if (!node.data?.bare || rest.length > 0 || child?.type !== 'text') {
    return null;
  }
  const text = child.value ?? '';
  const kind = bareKind(text, node.url ?? '');
  if (!kind || !beginsAfter(kind, before)) return null;
  return ENDS.test(after) || TRAIL.test(after) ? text : null;
}

/** remark's handler for links, a bare one written as its text. */
export const writeLink = Object.assign(
  ((node, parent, state, info) => {
    // A table cell is written between pipes, which end its text.
    const cell = state.stack.includes('tableCell');
    const edge = (char: string) => (cell && char === '|' ? '' : char);
    return (
      bareLinkText(node, edge(info.before), edge(info.after)) ??
      defaultHandlers.link(node, parent, state, info)
    );
  }) satisfies Handle,
  {
    // The first character written, for the text before the link to escape.
    peek: ((node, parent, state) =>
      bareLinkText(node, '', '')?.charAt(0) ??
      defaultHandlers.link.peek(node, parent, state)) satisfies Handle,
  }
);

/** Marks each link in `tree` that `source` spells bare. */
export function markBareLinks(tree: MdNode, source: string) {
  const visit = (node: MdNode) => {
    const offset = node.position?.start?.offset;
    if (node.type === 'link' && offset !== undefined) {
      const opening = source.charAt(offset);
      if (opening !== '[' && opening !== '<') {
        node.data = { ...node.data, bare: true };
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

export const bareLinkParse = $remark(
  'nyamark-bare-links',
  () => () => (tree, file) => markBareLinks(tree as MdNode, String(file.value))
);

/** `editor.config` hook: a link remembers that it was written bare. */
export function keepBareLinks(ctx: Ctx) {
  ctx.update(linkSchema.key, (base) => (schemaCtx) => {
    const schema = base(schemaCtx);
    return {
      ...schema,
      attrs: { ...schema.attrs, bare: { default: false } },
      // The page's link carries what a link in HTML has, not this.
      toDOM: (mark, inline) => {
        const [tag, { bare: _, ...attrs }] = schema.toDOM?.(mark, inline) as [
          string,
          Record<string, unknown>,
        ];
        return [tag, attrs];
      },
      parseMarkdown: {
        match: ({ type }) => type === 'link',
        runner: (state, node, type) => {
          state.openMark(type, {
            href: node.url as string,
            title: node.title as string | null,
            bare: (node as MdNode).data?.bare === true,
          });
          state.next(node.children);
          state.closeMark(type);
        },
      },
      toMarkdown: {
        match: (mark) => mark.type.name === 'link',
        runner: (state, mark) => {
          state.withMark(mark, 'link', undefined, {
            title: mark.attrs.title,
            url: mark.attrs.href,
            ...(mark.attrs.bare ? { data: { bare: true } } : {}),
          });
        },
      },
    };
  });
}
