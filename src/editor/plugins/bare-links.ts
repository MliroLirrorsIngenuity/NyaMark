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
 *
 * What follows the link is what is written after it, up to the next space:
 * remark gives a link only the first character of it. Text, a picture or
 * struck-out text right after a bare address went into the link when the
 * file was opened again, `https://a.com![](b.png)`. Bold or italics beside
 * it write the letter at that end of the link as a character reference where
 * their stars would open or close nothing otherwise, and the link was cut
 * there, `me@a.co&#x6D;*(b)*`. Those links are written in brackets.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { linkSchema } from '@milkdown/kit/preset/commonmark';
import { $remark } from '@milkdown/kit/utils';
import type { Root } from 'mdast';
import {
  type Handle,
  type Info,
  type State,
  defaultHandlers,
} from 'mdast-util-to-markdown';

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  data?: { bare?: boolean };
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: MdNode[];
};

export type Parse = (markdown: string) => Root;

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

type Parent = Parameters<Handle>[1];

/** Marks whose stars write a letter beside them as a character reference. */
const ATTENTION = new Set(['emphasis', 'strong']);

/**
 * What `state` writes for the child of `parent` at `index`, with what it
 * would write beside it as character references, the state left as it was.
 */
function writeAside(
  parent: Parent,
  index: number,
  state: State,
  info: Info
): { value: string; encodes: State['attentionEncodeSurroundingInfo'] } {
  const node = (parent?.children ?? [])[index];
  const stack = state.indexStack;
  const at = stack[stack.length - 1];
  const encodes = state.attentionEncodeSurroundingInfo;
  // remark-cjk-friendly's note to encode the text after bold.
  const cjk = state as { cjkFriendlyEncodeAfterSupplementaryText?: boolean };
  const supplementary = cjk.cjkFriendlyEncodeAfterSupplementaryText;
  stack[stack.length - 1] = index;
  try {
    const value = state.handle(node, parent, state, info);
    return { value, encodes: state.attentionEncodeSurroundingInfo };
  } finally {
    stack[stack.length - 1] = at;
    state.attentionEncodeSurroundingInfo = encodes;
    cjk.cjkFriendlyEncodeAfterSupplementaryText = supplementary;
  }
}

/**
 * What is written after `node`, the bare `text` of a link, up to the next
 * space; null when bold or italics beside it would write a letter at its
 * ends as a character reference.
 */
function writtenAfter(
  node: MdNode,
  parent: Parent,
  state: State,
  info: Info,
  text: string
): string | null {
  const siblings = (parent?.children ?? []) as MdNode[];
  const index = siblings.indexOf(node as never);
  if (index < 0) return readOnFrom(node, parent as MdNode, info.after);
  const previous = siblings[index - 1];
  if (previous && ATTENTION.has(previous.type)) {
    const aside = { ...info, before: '', after: text.charAt(0) };
    if (writeAside(parent, index - 1, state, aside).encodes?.after) {
      return null;
    }
  }
  let after = '';
  let next = index + 1;
  for (; next < siblings.length && !/[\s<]/.test(after); next++) {
    const aside = { ...info, before: (after || text).slice(-1), after: '' };
    const { value, encodes } = writeAside(parent, next, state, aside);
    if (next === index + 1 && encodes?.before) return null;
    after += value;
  }
  if (next < siblings.length) return after;
  const last = siblings[siblings.length - 1];
  return readOnFrom(last, parent as MdNode, last === node ? info.after : after);
}

type Spans = { from: number; to: number; url: string }[];
type Read = (source: string, pass: object) => Spans;

/**
 * The links `parse` reads bare in each source, kept from one pass of the
 * writer to the next.
 */
function bareReader(parse: Parse): Read {
  let current: object | null = null;
  let known = new Map<string, Spans>();
  let last = known;
  return (source, pass) => {
    if (pass !== current) {
      current = pass;
      last = known;
      known = new Map();
    }
    const links =
      known.get(source) ??
      last.get(source) ??
      bareLinksIn(parse(source), source).map((link) => ({
        from: link.position?.start?.offset ?? -1,
        to: link.position?.end?.offset ?? -1,
        url: link.url ?? '',
      }));
    known.set(source, links);
    return links;
  };
}

/**
 * The text `node` is written as, bare, between `before` and `after`: what
 * reads there as the same link. Null when it must be spelt out.
 */
function bareLinkText(
  read: Read,
  pass: object,
  node: MdNode,
  before: string,
  after: string
): string | null {
  const [child, ...rest] = node.children ?? [];
  if (!node.data?.bare || rest.length > 0 || child?.type !== 'text') {
    return null;
  }
  const text = child.value ?? '';
  const link = read(before + text + after, pass).find(
    ({ from }) => from === before.length
  );
  return link?.url === node.url && link?.to === before.length + text.length
    ? text
    : null;
}

/** remark's handler for links, a bare one written as its text. */
export function bareLinkWriter(parse: Parse) {
  const read = bareReader(parse);
  return Object.assign(
    ((node, parent, state, info) => {
      // A table cell is written between pipes, which end its text.
      const cell = state.stack.includes('tableCell');
      const before = cell && info.before === '|' ? '' : info.before;
      const text = node.data?.bare && (node.children[0] as MdNode)?.value;
      const after = text && writtenAfter(node, parent, state, info, text);
      return (
        (after != null &&
          bareLinkText(
            read,
            state,
            node,
            before,
            cell ? after.split('|')[0] : after
          )) ||
        defaultHandlers.link(node, parent, state, info)
      );
    }) satisfies Handle,
    {
      // The first character written, for the text before the link to
      // escape: a `www.` link after `!` is written in brackets, and the `!`
      // before them made it a picture.
      peek: ((node, parent, state) => {
        const siblings = (parent?.children ?? []) as MdNode[];
        const previous = siblings[siblings.indexOf(node) - 1];
        const before = previous?.type === 'text' ? (previous.value ?? '') : '';
        return (
          bareLinkText(read, state, node, before.slice(-1), '')?.charAt(0) ??
          defaultHandlers.link.peek(node, parent, state)
        );
      }) satisfies Handle,
    }
  );
}

/** The links in `tree` that `source` spells bare. */
export function bareLinksIn(tree: object, source: string): MdNode[] {
  const found: MdNode[] = [];
  const visit = (node: MdNode) => {
    const offset = node.position?.start?.offset;
    if (node.type === 'link' && offset !== undefined) {
      const opening = source.charAt(offset);
      if (opening !== '[' && opening !== '<') found.push(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree as MdNode);
  return found;
}

/** Marks each link in `tree` that `source` spells bare. */
export function markBareLinks(tree: MdNode, source: string) {
  for (const link of bareLinksIn(tree, source)) {
    link.data = { ...link.data, bare: true };
  }
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
