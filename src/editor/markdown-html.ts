import { gfmHtml } from 'micromark-extension-gfm';
import { mathHtml } from 'micromark-extension-math';

/**
 * How micromark writes what the app's Markdown holds beyond CommonMark as
 * HTML: GFM's constructs, and math drawn with KaTeX.
 */
export function markdownHtmlExtensions() {
  return [gfmHtml(), mathHtml({ throwOnError: false })];
}
