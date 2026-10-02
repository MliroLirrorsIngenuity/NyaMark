/**
 * Cmd+1 to Cmd+6 make the line a heading of that level and Cmd+0 makes it
 * text again, as in Typora and Bear. The preset had them only on Cmd+Option
 * with the digit, which stay.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import {
  headingKeymap,
  paragraphKeymap,
} from '@milkdown/kit/preset/commonmark';

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

export function headingDigitKeys(ctx: Ctx) {
  ctx.update(headingKeymap.key, (keys) => {
    const next = { ...keys };
    for (const level of LEVELS) {
      const name = `TurnIntoH${level}` as const;
      next[name] = {
        ...keys[name],
        shortcuts: [`Mod-Alt-${level}`, `Mod-${level}`],
      };
    }
    return next;
  });
  ctx.update(paragraphKeymap.key, (keys) => ({
    ...keys,
    TurnIntoText: { ...keys.TurnIntoText, shortcuts: ['Mod-Alt-0', 'Mod-0'] },
  }));
}
