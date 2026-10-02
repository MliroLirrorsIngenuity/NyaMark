/**
 * The format bar's heading list names the code block or the formula the caret
 * is in, and stays shut there. It read 正文, as on a line of text, and a
 * heading picked from it did nothing to the code.
 */

import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { i18next } from '../../i18n';

/** On the editor root while the caret is in code; the bar's CSS reads it. */
const IN_CODE_CLASS = 'ny-caret-in-code';

type Builder = {
  build: () => {
    key: string;
    items: { key: string; selector?: { activeLabel: (ctx: Ctx) => string } }[];
  }[];
};

/** The code block's name, or the formula's, a formula being LaTeX code. */
function codeLabel(node: Node) {
  const language = String(node.attrs.language ?? '').toLowerCase();
  return i18next.t(
    `editor.blocks.${language === 'latex' ? 'math' : 'codeBlock'}`
  );
}

/** Has the bar's heading list name the code the caret is in. */
export function intoHeadingSelector(builder: Builder) {
  const selector = builder
    .build()
    .find((group) => group.key === 'heading')
    ?.items.find((item) => item.key === 'heading-selector')?.selector;
  if (!selector) return;
  const label = selector.activeLabel;
  selector.activeLabel = (ctx) => {
    const { parent } = ctx.get(editorViewCtx).state.selection.$from;
    return parent.type.spec.code ? codeLabel(parent) : label(ctx);
  };
}

export const markCaretInCode = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/caret-in-code'),
      view: (view) => {
        const update = () => {
          const inCode = !!view.state.selection.$from.parent.type.spec.code;
          view.dom
            .closest('.milkdown')
            ?.classList.toggle(IN_CODE_CLASS, inCode);
        };
        update();
        return {
          update,
          destroy: () =>
            view.dom.closest('.milkdown')?.classList.remove(IN_CODE_CLASS),
        };
      },
    })
);
