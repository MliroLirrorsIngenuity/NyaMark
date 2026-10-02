/**
 * The mark of a footnote in a line is passed over by the arrow keys as a
 * letter is. An arrow key selected it on the way past, and the next letter
 * typed took its place: the footnote lost its mark with nothing to show it.
 *
 * The number in front of a footnote's text is passed over by up and down as
 * the margin is. WebKit took it for a line of text of its own: down onto a
 * footnote went to the start of its text, wherever the caret had been, and
 * up from the start of one went to the end of the footnote above.
 */

import {
  footnoteDefinitionSchema,
  footnoteReferenceSchema,
} from '@milkdown/kit/preset/gfm';

export const footnoteMark = footnoteReferenceSchema.extendSchema(
  (prev) => (ctx) => ({ ...prev(ctx), selectable: false })
);

export const footnoteNumber = footnoteDefinitionSchema.extendSchema(
  (prev) => (ctx) => ({
    ...prev(ctx),
    toDOM: (node) => [
      'dl',
      { 'data-label': node.attrs.label, 'data-type': 'footnote_definition' },
      ['dt', { contenteditable: 'false' }, node.attrs.label],
      ['dd', 0],
    ],
  })
);
