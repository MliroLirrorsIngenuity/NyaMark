/**
 * A task list pasted from a page made from Markdown keeps its boxes. GitHub,
 * Obsidian and others draw a task as a list item that opens with a checkbox,
 * which was read as an item of a plain list: the boxes were gone, and with
 * them what had been ticked.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { TagParseRule } from '@milkdown/kit/prose/model';

const ELEMENT = 1;
const TEXT = 3;
/** What the box of an item may sit in: its first paragraph, or a label. */
const OPENERS = new Set(['P', 'LABEL', 'SPAN']);

/** The checkbox `item` opens with, ahead of any text. */
export function openingBox(item: Node): Element | null {
  for (const child of item.childNodes) {
    if (child.nodeType === TEXT) {
      if (child.textContent?.trim()) return null;
      continue;
    }
    if (child.nodeType !== ELEMENT) continue;
    const element = child as Element;
    if (element.nodeName === 'INPUT') {
      return element.getAttribute('type')?.toLowerCase() === 'checkbox'
        ? element
        : null;
    }
    return OPENERS.has(element.nodeName) ? openingBox(element) : null;
  }
  return null;
}

/** `editor.config` hook. */
export function keepPastedTasks(ctx: Ctx) {
  ctx.update(extendListItemSchemaForTask.key, (base) => (schemaCtx) => {
    const schema = base(schemaCtx);
    const rules = schema.parseDOM ?? [];
    const plain = rules.find(
      (rule): rule is TagParseRule => 'tag' in rule && rule.tag === 'li'
    );
    const task: TagParseRule = {
      tag: 'li',
      getAttrs: (dom) => {
        const box = openingBox(dom);
        if (!box) return false;
        const attrs = plain?.getAttrs?.(dom);
        return { ...(attrs || {}), checked: box.hasAttribute('checked') };
      },
    };
    return { ...schema, parseDOM: [task, ...rules] };
  });
}
