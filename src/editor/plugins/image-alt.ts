/**
 * Keeps the alt text of an image block through a save. Milkdown's
 * image block keeps the height the image was resized to in the alt text and
 * reads every alt back as that ratio, so `![猫](cat.png)` was saved as
 * `![1.00](cat.png)`, and every image in a saved file gained a `1.00`.
 *
 * The alt text is now an attribute of its own. A resized image still writes
 * its ratio into the alt, the one place Milkdown reads it from: resizing is
 * the edit, and an alt in Milkdown's `0.50` shape is read back as a ratio.
 * An image at its natural size writes its alt text, or nothing.
 */

import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import type { Ctx } from '@milkdown/kit/ctx';

/** The shape Milkdown writes a ratio in: `toFixed(2)`. */
const RATIO_ALT = /^\d+\.\d{2}$/;

export function imageAttrsFromAlt(alt: unknown): {
  alt: string;
  ratio: number;
} {
  const text = typeof alt === 'string' ? alt : '';
  if (!RATIO_ALT.test(text)) return { alt: text, ratio: 1 };
  const ratio = Number(text);
  return { alt: '', ratio: ratio > 0 ? ratio : 1 };
}

export function altFromImageAttrs(alt: unknown, ratio: unknown): string {
  const value = Number(ratio);
  if (Number.isFinite(value) && value > 0 && value.toFixed(2) !== '1.00') {
    return value.toFixed(2);
  }
  return typeof alt === 'string' ? alt : '';
}

/** `editor.config` hook: extends Crepe's image block with the alt text. */
export function keepImageAlt(ctx: Ctx) {
  ctx.update(imageBlockSchema.key, (base) => (schemaCtx) => {
    const schema = base(schemaCtx);
    return {
      ...schema,
      attrs: { ...schema.attrs, alt: { default: '', validate: 'string' } },
      // Copy and paste go through the DOM, where `toDOM` writes every attr.
      parseDOM: schema.parseDOM?.map((rule) => ({
        ...rule,
        getAttrs: (dom: HTMLElement) => {
          const attrs = rule.getAttrs?.(dom);
          if (attrs === false) return false;
          return { ...attrs, alt: dom.getAttribute('alt') ?? '' };
        },
      })),
      parseMarkdown: {
        match: ({ type }) => type === 'image-block',
        runner: (state, node, type) => {
          state.addNode(type, {
            src: node.url as string,
            // An image with no title has `null` for one, which the
            // caption's attr does not take.
            caption: (node.title as string | null) ?? '',
            ...imageAttrsFromAlt(node.alt),
          });
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'image-block',
        runner: (state, node) => {
          state.openNode('paragraph');
          state.addNode('image', undefined, undefined, {
            title: node.attrs.caption,
            url: node.attrs.src,
            alt: altFromImageAttrs(node.attrs.alt, node.attrs.ratio),
          });
          state.closeNode();
        },
      },
    };
  });
}
