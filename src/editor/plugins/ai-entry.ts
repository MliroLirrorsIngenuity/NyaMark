/**
 * Where the editor opens the assistant's AI menu: a button at the end of the
 * selection toolbar, and an AI group in the slash menu. The assistant loads
 * once one is used; until then, a handler set by the app waits for it.
 */

import { commandsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { i18next } from '../../i18n';

/** The AI menu to choose from, or one of its commands run at once. */
export type AiAskMode = 'menu' | 'continue' | 'summarize';

let handler: ((mode: AiAskMode) => void) | null = null;

/** Sets what opens the AI menu; the app does once the editor is built. */
export function setAiAskHandler(next: ((mode: AiAskMode) => void) | null) {
  handler = next;
}

function ask(mode: AiAskMode) {
  handler?.(mode);
}

const AI_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M10 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5Z" />
    <path d="M17.5 14.5c.28 2.03.97 2.72 3 3-2.03.28-2.72.97-3 3-.28-2.03-.97-2.72-3-3 2.03-.28 2.72-.97 3-3Z" />
  </svg>
`;

type ToolbarBuilder = {
  addGroup: (
    key: string,
    label: string
  ) => {
    addItem: (
      key: string,
      item: {
        icon: string;
        active: (ctx: Ctx) => boolean;
        onRun?: (ctx: Ctx) => void;
      }
    ) => unknown;
  };
};

type SlashBuilder = {
  addGroup: (
    key: string,
    label: string
  ) => {
    addItem: (
      key: string,
      item: { label: string; icon: string; onRun?: (ctx: Ctx) => void }
    ) => SlashGroup;
  };
};

type SlashGroup = ReturnType<SlashBuilder['addGroup']>;

/** The selection toolbar's AI button, after its own. */
export function intoAiToolbar(builder: ToolbarBuilder) {
  builder.addGroup('ai', 'AI').addItem('ai-ask', {
    icon: AI_ICON,
    active: () => false,
    onRun: () => ask('menu'),
  });
}

const SLASH_ITEMS: [key: string, mode: AiAskMode][] = [
  ['aiContinue', 'continue'],
  ['aiWrite', 'menu'],
  ['aiSummarize', 'summarize'],
];

/** The slash menu's AI group, under its blocks. */
export function intoAiSlash(builder: SlashBuilder) {
  const group = builder.addGroup('ai', i18next.t('editor.blocks.groupAi'));
  for (const [key, mode] of SLASH_ITEMS) {
    group.addItem(key, {
      label: i18next.t(`editor.blocks.${key}`),
      icon: AI_ICON,
      onRun: (ctx) => {
        // The slash and what was typed after it go first, leaving the line
        // the reply takes.
        ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
        ask(mode);
      },
    });
  }
}
