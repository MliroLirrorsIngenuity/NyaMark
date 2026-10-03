/**
 * A link reference definition no link uses stays in the file. Milkdown turns
 * every `[text][label]` into a plain link with the address its definition
 * gives, and drops the definitions: one kept for later, or for another
 * tool's use, was gone after the first save.
 *
 * Each one no reference takes is read as a line of raw HTML instead, shown
 * as written and saved back as written. The definitions links use still go
 * into their links.
 */

import { InitReady, remarkPluginsCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { RemarkPlugin } from '@milkdown/kit/transformer';

type MdNode = {
  type: string;
  identifier?: string;
  url?: string;
  title?: string | null;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
};

function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** A label as references match it: case and spacing aside. */
function identify(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, ' ')
    .replace(/^ | $/g, '')
    .toLowerCase()
    .toUpperCase()
    .toLowerCase();
}

/**
 * The label as written, its lines joined. The one remark reads has its
 * escapes undone, and `[x\*y]` written back as `[x*y]` took the links of
 * another label. The identifier stands in where the source shows none.
 */
function writtenLabel(node: MdNode, written: string): string {
  const label = /^\[((?:[^\\\]]|\\[\s\S])*)\]/
    .exec(written)?.[1]
    ?.replace(/[ \t]*\n[ \t>]*/g, ' ');
  return label !== undefined && identify(label) === node.identifier
    ? label
    : (node.identifier ?? '');
}

/** The definition on one line, for one written over several. */
function writeDefinition(node: MdNode, written: string): string {
  const url = node.url ?? '';
  const address =
    url === '' || /[\s<>]/.test(url)
      ? `<${url.replace(/[<>\\]/g, '\\$&')}>`
      : url;
  const title =
    node.title == null ? '' : ` "${node.title.replace(/["\\]/g, '\\$&')}"`;
  return `[${writtenLabel(node, written)}]: ${address}${title}`;
}

/** Remark transformer: each definition no reference takes made raw HTML. */
export function keepUnusedDefinitions() {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    const referenced = new Set<string>();
    walk(tree, (node) => {
      if (
        (node.type === 'linkReference' || node.type === 'imageReference') &&
        node.identifier
      ) {
        referenced.add(node.identifier);
      }
    });

    // The first definition of a label is the one its references take.
    const taken = new Set<string>();
    walk(tree, (node) => {
      for (const [index, child] of (node.children ?? []).entries()) {
        if (child.type !== 'definition') continue;
        const id = child.identifier ?? '';
        if (referenced.has(id) && !taken.has(id)) {
          taken.add(id);
          continue;
        }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        const written =
          start !== undefined && end !== undefined
            ? source.slice(start, end)
            : '';
        // Over several lines, the source holds quote markers or list
        // indentation too.
        const value =
          written.startsWith('[') && !written.includes('\n')
            ? written
            : writeDefinition(child, written);
        // In a paragraph of its own, where Milkdown takes raw HTML in any
        // block that holds it.
        node.children?.splice(index, 1, {
          type: 'paragraph',
          children: [{ type: 'html', value }],
        });
      }
    });
  };
}

/**
 * Run ahead of the remark plugins Milkdown brings, the one that drops the
 * definitions among them; `$remark` would add it after them.
 */
export const linkDefinitions: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady);
  const plugin = {
    plugin: keepUnusedDefinitions,
    options: {},
  } as RemarkPlugin;
  ctx.update(remarkPluginsCtx, (plugins) => [plugin, ...plugins]);
  return () => {
    ctx.update(remarkPluginsCtx, (plugins) =>
      plugins.filter((entry) => entry !== plugin)
    );
  };
};
