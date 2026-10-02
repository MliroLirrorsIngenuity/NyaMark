/**
 * Cmd+Shift+B, Cmd+Option+8, Cmd+Option+7 and Cmd+Option+C do what the
 * toolbar's quote, list and code buttons do (see toolbar-toggles and
 * toolbar-insert). The preset's own keys only wrapped: in a quote Cmd+Shift+B
 * put a second quote inside it, in a list the list keys did nothing, and the
 * first line of an item went into a quote or code with the whole list.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import {
  blockquoteKeymap,
  bulletListKeymap,
  codeBlockKeymap,
  orderedListKeymap,
} from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import { $prose } from '@milkdown/kit/utils';

type Item = { key: string; onRun?: (ctx: Ctx) => void };
type Builder = { build: () => { key: string; items: Item[] }[] };

/** The toolbar button each key stands for, by its group and key. */
const KEYS: [shortcut: string, group: string, key: string][] = [
  ['Mod-Shift-b', 'more', 'quote'],
  ['Mod-Alt-8', 'list', 'bullet-list'],
  ['Mod-Alt-7', 'list', 'ordered-list'],
  ['Mod-Alt-c', 'block', 'code-block'],
];

/** What the buttons run, as the toolbar was last built. */
const runs = new Map<string, (ctx: Ctx) => void>();

/** Notes what the buttons run, once the other changes to them are made. */
export function intoKeys(builder: Builder) {
  const groups = builder.build();
  for (const [shortcut, group, key] of KEYS) {
    const run = groups
      .find((g) => g.key === group)
      ?.items.find((i) => i.key === key)?.onRun;
    if (run) runs.set(shortcut, run);
  }
}

/** Takes the preset's own bindings off the keys. */
export function dropWrapKeys(ctx: Ctx) {
  ctx.update(blockquoteKeymap.key, (keys) => ({
    ...keys,
    WrapInBlockquote: { ...keys.WrapInBlockquote, shortcuts: [] },
  }));
  ctx.update(bulletListKeymap.key, (keys) => ({
    ...keys,
    WrapInBulletList: { ...keys.WrapInBulletList, shortcuts: [] },
  }));
  ctx.update(orderedListKeymap.key, (keys) => ({
    ...keys,
    WrapInOrderedList: { ...keys.WrapInOrderedList, shortcuts: [] },
  }));
  ctx.update(codeBlockKeymap.key, (keys) => ({
    ...keys,
    CreateCodeBlock: { ...keys.CreateCodeBlock, shortcuts: [] },
  }));
}

export const blockKeys = $prose((ctx) =>
  keymap(
    Object.fromEntries(
      KEYS.map(([shortcut]) => [
        shortcut,
        () => {
          const run = runs.get(shortcut);
          if (!run) return false;
          run(ctx);
          return true;
        },
      ])
    )
  )
);
