/**
 * Home and End take the caret to the start and the end of the line on
 * screen, Shift with them selecting to there, as they do in a code block and
 * as ⌘← and ⌘→ do. In text they only scrolled the page, so the same key
 * moved the caret in code and did nothing to it a line away.
 */

import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const homeEnd = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/home-end'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Home' && event.key !== 'End') return false;
          if (event.metaKey || event.ctrlKey || event.altKey) return false;
          if (event.isComposing) return false;
          if (!(view.state.selection instanceof TextSelection)) return false;
          const selection = view.dom.ownerDocument.getSelection();
          if (!selection?.rangeCount) return false;
          // The browser's own ⌘← and ⌘→, which ProseMirror reads back.
          selection.modify(
            event.shiftKey ? 'extend' : 'move',
            event.key === 'Home' ? 'backward' : 'forward',
            'lineboundary'
          );
          return true;
        },
      },
    })
);
