/**
 * Emphasis beside Chinese, Japanese and Korean text.
 *
 * CommonMark opens and closes `**` only where the characters around it allow:
 * `这是**“引用”**的` and `价格**100%**以上` were read as plain text with the
 * stars in it, and text made bold in the editor came back that way when the
 * file was opened again. These read it as Typora does; text in other scripts
 * reads as before.
 */

import { $remark } from '@milkdown/kit/utils';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';

export const cjkEmphasis = $remark(
  'nyamark-cjk-emphasis',
  () => remarkCjkFriendly
);

/** The same for `~~`, after GFM's own strikethrough. */
export const cjkStrikethrough = $remark(
  'nyamark-cjk-strikethrough',
  () => remarkCjkFriendlyStrikethrough
);
