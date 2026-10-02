/**
 * The mark of a footnote in a line is passed over by the arrow keys as a
 * letter is. An arrow key selected it on the way past, and the next letter
 * typed took its place: the footnote lost its mark with nothing to show it.
 */

import { footnoteReferenceSchema } from '@milkdown/kit/preset/gfm';

export const footnoteMark = footnoteReferenceSchema.extendSchema(
  (prev) => (ctx) => ({ ...prev(ctx), selectable: false })
);
