/**
 * What is typed at either end of a link goes outside it, as it does in Pages
 * and Google Docs. Typed after a link's last letter it went into the link,
 * and only a press of → that moved nothing on screen let the caret out.
 */

import { linkSchema } from '@milkdown/kit/preset/commonmark';

export const linkMark = linkSchema.extendSchema((prev) => (ctx) => ({
  ...prev(ctx),
  inclusive: false,
}));
