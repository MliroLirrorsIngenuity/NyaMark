/**
 * Shift+Enter in a heading starts a new line as Enter does. It broke the
 * heading over two lines, which Markdown can only write underlined with
 * `===`, and the `#` heading was saved so.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const headingShiftEnter = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/heading-break'),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || !event.shiftKey || event.isComposing)
            return false;
          if (event.altKey || event.metaKey || event.ctrlKey) return false;
          if (view.state.selection.$from.parent.type.name !== 'heading')
            return false;
          const enter = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          });
          // ProseMirror's keymaps read the key code too.
          Object.defineProperty(enter, 'keyCode', { value: 13 });
          view.someProp('handleKeyDown', (handle) => handle(view, enter));
          return true;
        },
      },
    })
);
