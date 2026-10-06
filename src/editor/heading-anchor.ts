/**
 * Each heading's id is the anchor GitHub gives it, made by github-slugger as
 * GitHub's own pages make it: its text in lower case, the punctuation
 * dropped, each space a hyphen, and `-1`, `-2` after a name already taken. A
 * link to `#a-heading` written for GitHub reaches the same heading here.
 */

import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Transform } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import GithubSlugger, { slug } from 'github-slugger';

/**
 * A heading's text as the outline shows it, a formula by its TeX and an image
 * by its alt text. A heading of a formula or a logo alone has no other text:
 * it stood in the outline as an empty line, with no id to go to.
 */
export function headingLabel(heading: Node): string {
  return heading
    .textBetween(0, heading.content.size, undefined, (leaf) =>
      String(leaf.attrs.value ?? leaf.attrs.alt ?? ' ')
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text a heading's anchor is made of: its label when it has no text. */
function anchorText(heading: Node) {
  return heading.textContent.trim()
    ? heading.textContent
    : headingLabel(heading);
}

/** A heading's anchor taken alone, as the first with its text has it. */
export const headingId = (heading: Node): string => slug(anchorText(heading));

/** The id a heading has on the page, before it is given one too. */
export const pageId = (heading: Node): string =>
  String(heading.attrs.id || headingId(heading));

/**
 * `tr` with each heading in its document given its anchor, in order. One
 * with nothing to show has none, as it has no place in the outline.
 */
export function setHeadingIds<T extends Transform>(tr: T): T {
  const slugger = new GithubSlugger();
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return !node.isTextblock;
    const id = headingLabel(node) ? slugger.slug(anchorText(node)) : '';
    if (node.attrs.id !== id) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    }
    return false;
  });
  return tr;
}

/**
 * Keeps each heading's id its anchor, in place of Milkdown's own plugin, which
 * numbered a repeat `-#2`. Like that one it waits while a word is being
 * composed: the heading drawn anew broke the word.
 */
export const headingIds = $prose(() => {
  const sync = (view: EditorView) => {
    if (view.composing) return;
    const tr = setHeadingIds(view.state.tr);
    if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
  };
  return new Plugin({
    key: new PluginKey('nya-heading-ids'),
    view: (view) => {
      sync(view);
      return {
        update: (view, prevState) => {
          if (!view.state.doc.eq(prevState.doc)) sync(view);
        },
      };
    },
  });
});
