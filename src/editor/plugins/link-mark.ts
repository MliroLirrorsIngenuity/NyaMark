/**
 * What is typed at either end of a link goes outside it, as it does in Pages
 * and Google Docs. Typed after a link's last letter it went into the link,
 * and only a press of → that moved nothing on screen let the caret out.
 *
 * The link's schema is changed where it stands, as bare-links changes it: a
 * schema extended apart took the link's place in the editor and left out what
 * bare-links had added, so a link written bare was saved in angle brackets.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { linkSchema } from '@milkdown/kit/preset/commonmark';

export function typeOutsideLinks(ctx: Ctx) {
  ctx.update(linkSchema.key, (base) => (schemaCtx) => ({
    ...base(schemaCtx),
    inclusive: false,
  }));
}
