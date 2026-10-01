/**
 * Keeps an image's height in step with its ratio. Milkdown's image block sizes
 * the picture once, when it loads, and a drag on the resize handle writes the
 * height straight onto the image: undoing a resize put the ratio back in the
 * document, and the picture stayed at the height it was dragged to.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const imageRatio = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/image-ratio'),
      view: () => ({
        update(view, prevState) {
          if (view.state.doc === prevState.doc) return;
          view.state.doc.descendants((node, pos) => {
            if (node.type.name !== 'image-block') return !node.isTextblock;
            const dom = view.nodeDOM(pos);
            const image =
              dom instanceof HTMLElement ? dom.querySelector('img') : null;
            // The height the image was laid out at, once it has loaded.
            const origin = Number(image?.dataset.origin);
            if (!image || !(origin > 0)) return false;
            const height = (origin * (Number(node.attrs.ratio) || 1)).toFixed(
              2
            );
            if (image.dataset.height !== height) {
              image.dataset.height = height;
              image.style.height = `${height}px`;
            }
            return false;
          });
        },
      }),
    })
);
