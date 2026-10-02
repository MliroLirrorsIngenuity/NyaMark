/**
 * An image in a line comes in from HTML with the title it has. Milkdown took
 * the alt text for the title where there was none, so `![猫](cat.png)` copied
 * and pasted here came back as `![猫](cat.png "猫")`, and so did an image
 * pasted from a web page: the file gained a title the image never had.
 *
 * Opened from a file, an image with no title or alt text had `null` for
 * them, which the image's attrs do not take.
 */

import { imageSchema } from '@milkdown/kit/preset/commonmark';

export const imageOwnTitle = imageSchema.extendSchema((prev) => (ctx) => {
  const schema = prev(ctx);
  return {
    ...schema,
    parseDOM: schema.parseDOM?.map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement) => {
        const attrs = rule.getAttrs?.(dom);
        if (attrs === false) return false;
        return { ...attrs, title: dom.getAttribute('title') ?? '' };
      },
    })),
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner: (state, node, type) => {
        schema.parseMarkdown.runner(
          state,
          { ...node, alt: node.alt ?? '', title: node.title ?? '' },
          type
        );
      },
    },
  };
});
