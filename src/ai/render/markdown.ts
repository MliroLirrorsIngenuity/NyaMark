import DOMPurify, { type Config } from 'dompurify';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { markdownHtmlExtensions } from '../../editor/markdown-html';

/**
 * What a reply may hold once it is HTML: no scripts, forms, frames or styles,
 * and links only to the web or mail. Raw HTML in a reply is shown as text
 * (micromark escapes it), so this guards against what the Markdown itself
 * can make.
 */
const SANITIZE: Config = {
  FORBID_TAGS: [
    'style',
    'link',
    'meta',
    'base',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'iframe',
    'object',
    'embed',
    'img',
  ],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

/**
 * A reply in Markdown as HTML, before it is sanitized. A reply still
 * streaming may end in the middle of a construct; micromark closes what is
 * open.
 */
export function chatMarkdownHtml(markdown: string): string {
  try {
    return micromark(markdown, {
      extensions: [gfm(), math()],
      htmlExtensions: markdownHtmlExtensions(),
    });
  } catch {
    return micromark(markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
  }
}

/** A reply in Markdown as HTML for the panel. */
export function renderChatMarkdown(markdown: string): string {
  return DOMPurify.sanitize(chatMarkdownHtml(markdown), SANITIZE) as string;
}

/** Only these leave the app from a reply's link. */
export function isOpenableLink(href: string): boolean {
  return /^(?:https?:|mailto:)/i.test(href);
}
