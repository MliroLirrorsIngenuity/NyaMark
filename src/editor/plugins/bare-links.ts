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

// What a bare link ends before: GFM leaves stops and stars out of its end
// when nothing but space follows them
// (`micromark-extension-gfm-autolink-literal`).
const ENDS = /^[!"&')*,.:;?\]_~]*(?:[\s<]|$)/;

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

/** Whether a reader ends a link of `kind` right before `after`. */
function endsBefore(kind: string, after: string) {
  // An email address ends at anything its domain cannot hold, `。` too.
  if (kind === 'email') return !/[-_A-Za-z0-9]/.test(after.charAt(0));
  return ENDS.test(after);
}

/** What follows each bold or italics being written, and what holds it. */
const following = new WeakMap<object, { parent?: object; after: string }>();

/**
 * Notes what follows `node`, bold or italics. A link at the end of it is
 * followed by its stars and then by that: GFM read on through the stars in
 * `**https://…**。`, and the link took them and the `。` into it.
 */
export function noteFollowing(
  node: object,
  parent: object | undefined,
  after: string
) {
  following.set(node, { parent, after });
}

/** What follows `node`, through the ends of the marks it ends. */
function readOnFrom(node: object, parent: MdNode | undefined, after: string) {
  let text = after;
  let child = node;
  let around = parent;
  while (around?.children?.[around.children.length - 1] === child) {
    const outside = following.get(around);
    if (!outside) break;
    text += outside.after;
    child = around;
    around = outside.parent as MdNode | undefined;
  }
  return text;
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
  return endsBefore(kind, after) ? text : null;
}

/** remark's handler for links, a bare one written as its text. */
export const writeLink = Object.assign(
  ((node, parent, state, info) => {
    // A table cell is written between pipes, which end its text.
    const cell = state.stack.includes('tableCell');
    const edge = (char: string) => (cell && char === '|' ? '' : char);
    const after = readOnFrom(node, parent, info.after);
    return (
      bareLinkText(
        node,
        edge(info.before),
        cell ? after.split('|')[0] : after
      ) ?? defaultHandlers.link(node, parent, state, info)
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
      // The page's link carries what a link in HTML has, and a mark that it
      // was bare: copied and pasted, a bare link was written in brackets.
      toDOM: (mark, inline) => {
        const [tag, { bare, ...attrs }] = schema.toDOM?.(mark, inline) as [
          string,
          Record<string, unknown>,
        ];
        return [tag, bare ? { ...attrs, 'data-bare': '' } : attrs];
      },
      parseDOM: schema.parseDOM?.map((rule) =>
        typeof rule.tag === 'string'
          ? {
              ...rule,
              getAttrs: (dom: HTMLElement) => {
                const attrs = rule.getAttrs?.(dom);
                if (attrs === false) return false;
                return { ...attrs, bare: dom.hasAttribute('data-bare') };
              },
            }
          : rule
      ),
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
