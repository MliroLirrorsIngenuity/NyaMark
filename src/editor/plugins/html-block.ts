import { remarkCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $ctx, $prose, $remark, $view } from '@milkdown/kit/utils';
import DOMPurify, { type Config } from 'dompurify';
import { type Options, micromark } from 'micromark';
import { ensureStyle } from '../../style/register';
import { forInputMethod } from '../../ui/ime';
import { markdownHtmlExtensions } from '../markdown-html';

/**
 * Raw HTML blocks come straight from the opened markdown file, which may be
 * untrusted (e.g. a `.md` opened via file association). Sanitize before it ever
 * touches innerHTML so embedded scripts / event handlers cannot execute inside
 * the privileged Tauri webview.
 *
 * DOMPurify's defaults still let a `<style>` element through, and a stylesheet
 * applies to the whole document: a note could hide the title bar or paint a
 * fake dialog over the editor. Form controls are dropped as well; they cannot
 * submit anywhere (CSP `form-action 'none'`) and only serve phishing-style
 * mockups. Inline `style` attributes stay allowed because centred images and
 * sized tables are everyday Markdown; the preview container uses
 * `contain: paint`, which turns it into the containing block for fixed and
 * absolutely positioned descendants, so nothing inside can escape its box.
 */
const SANITIZE_OPTIONS: Config = {
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
  ],
  // Default list minus exotic schemes, plus `asset:` for local images.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};

function sanitizeHtmlBlock(value: string): string {
  return DOMPurify.sanitize(value, SANITIZE_OPTIONS);
}

/**
 * Turns an image address into one the webview can load: the resolver the
 * image blocks use, set in the editor's config.
 */
export const htmlImageSource = $ctx<
  (src: string) => Promise<string> | string,
  'nyamarkHtmlImageSource'
>((src) => src, 'nyamarkHtmlImageSource');

const LINKING_TAG = /<(?:img|a|source|video|audio)\b[^>]*>/gi;
const ADDRESS =
  /(\s(?:src|href|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/**
 * `html` with the address of each image and link in it run through `mapper`
 * (see `rewriteLocalReferences`); an address it returns null for stays.
 */
export function htmlReferencesMapped(
  html: string,
  mapper: (reference: string) => string | null
): string {
  return html.replace(LINKING_TAG, (tag) =>
    tag.replace(ADDRESS, (whole, lead: string, ...values: unknown[]) => {
      const [double, single, bare] = values as Array<string | undefined>;
      const reference = double ?? single ?? bare ?? '';
      const next = mapper(reference);
      const quote = single === undefined ? '"' : "'";
      if (next === null || next === reference || next.includes(quote)) {
        return whole;
      }
      return `${lead}${quote}${next}${quote}`;
    })
  );
}

/** Addresses the webview loads as they are. */
const LOADS_AS_IS = /^(?:https?:|data:|blob:|asset:)/i;

/**
 * The images in `root` with an address beside the document, their `src`
 * taken off. Read against the app's own address, `<img src="img/logo.png">`
 * of a README showed as a broken image.
 */
function holdLocalImages(root: ParentNode) {
  const held: Array<[HTMLImageElement, string]> = [];
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src')?.trim();
    if (!src || LOADS_AS_IS.test(src)) continue;
    image.removeAttribute('src');
    held.push([image, src]);
  }
  return held;
}

type Syntax = NonNullable<Options['extensions']>;

/**
 * A tag that starts the text opens no block of HTML, as it opens none in the
 * line: `<div>**x**</div>` among words is bold.
 */
const IN_A_LINE: Syntax[number] = { disable: { null: ['htmlFlow'] } };

/**
 * The HTML a piece of running text makes: its tags, and the Markdown between
 * them read with `syntax`, the editor's, as the line it stands in reads it.
 */
export function inlineHtml(value: string, syntax: Syntax): string {
  const html = micromark(value, {
    allowDangerousHtml: true,
    extensions: [...syntax, IN_A_LINE],
    htmlExtensions: markdownHtmlExtensions(),
  });
  return /^<p>([\s\S]*)<\/p>\s*$/.exec(html)?.[1] ?? html;
}

/** Elements that show, with no text in them. */
const SHOWN_EMPTY = 'img, br, hr, svg, video, audio, picture, canvas, math';

const css = `
/* The paragraph it sits in spaces it from the blocks around it, as every
   other block is spaced. */
.ny-html-block {
  position: relative;
  transition: background-color 0.2s;
}

/* What ProseMirror leaves after an atom that ends a line stood under the
   block as a blank line. The caret never rests beside the block. */
p:has(> .ny-html-block) > :is(.ProseMirror-separator, .ProseMirror-trailingBreak) {
  display: none !important;
}

.ny-html-preview {
  padding: 0.2rem 0;
  cursor: pointer;
  white-space: normal;
  line-height: normal;
  color: var(--ny-text-primary);
  /* Containing block for fixed/absolute children: untrusted HTML cannot
     overlay the surrounding UI. Wide content scrolls instead of clipping. */
  contain: paint;
  overflow-x: auto;
}

.ny-html-preview :where(p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote) {
  margin: 1em 0;
}

.ny-html-preview :where(h1, h2, h3, h4, h5, h6) {
  line-height: 1.2;
}

.ny-html-preview :where(p:first-child, h1:first-child, h2:first-child, h3:first-child, h4:first-child, h5:first-child, h6:first-child) {
  margin-top: 0;
}

.ny-html-preview :where(p:last-child, h1:last-child, h2:last-child, h3:last-child, h4:last-child, h5:last-child, h6:last-child) {
  margin-bottom: 0;
}

.ny-html-preview :where(img) {
  max-width: 100%;
  height: auto;
}

/* Raised or lowered, a citation mark stood its line apart from the rest. */
.ny-html-preview :where(sup, sub) {
  line-height: 0;
}

.ny-html-source .ny-html-preview {
  color: var(--ny-text-muted);
  font-family: var(--ny-font-mono);
  font-size: 0.88em;
  white-space: pre-wrap;
}

.ny-html-inline.ny-html-source .ny-html-preview {
  padding: 0 0.2em;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.12);
}

/* Drawn in the line it stands in. Positioned, so what it places absolutely
   stays in the editor's scrolling: paint containment holds no inline box. */
.ny-html-inline:not(.ny-html-source) .ny-html-preview {
  position: relative;
  padding: 0;
  line-height: inherit;
}

.ny-html-inline .ny-html-editor {
  display: inline-block;
  width: auto;
  max-width: 100%;
  min-height: 0;
  padding: 0 0.2em;
}

.ny-html-preview:hover {
  background: rgba(128, 128, 128, 0.05);
}

/* Sized as a code block is, a line of source as high as a line of code. */
.ny-html-editor {
  display: block;
  width: 100%;
  padding: 6px 12px;
  /* The surface of a code block, as the source it is. */
  border: 1px solid var(--ny-editor-codeblock-border);
  border-radius: 12px;
  background: var(--ny-editor-codeblock-bg);
  color: var(--ny-text-primary);
  /* The editor draws its own caret and leaves the native one clear, which
     the field took in: clicked into, the source showed no caret at all. */
  caret-color: var(--ny-text-primary);
  font-family: var(--ny-font-mono);
  font-size: 13px;
  line-height: 1.4;
  resize: none;
  outline: none;
  overflow: hidden;
}

/* The block under the editor's selection clears the native one in it, and
   text selected in its source showed nothing. The field selects as text
   in the document does. */
.ny-editor-root .milkdown .ProseMirror :is(.ny-html-block, .ny-html-inline) > .ny-html-editor::selection {
  background-color: color-mix(in srgb, var(--ny-accent), transparent 72%) !important;
}
`;

export function registerHtmlBlockStyles() {
  ensureStyle('editor-html-block', css);
}

declare module 'mdast' {
  interface HtmlData {
    /** Read as a block of HTML, and not as tags in a line of text. */
    block?: boolean;
  }
}

/**
 * HTML the file has as a block, as micromark reads it (`htmlFlow`), marked so
 * as it is parsed. Milkdown wraps it alone in a paragraph to hold it
 * (`remarkHtmlTransformer`), and a paragraph of nothing but tags looked the
 * same: `<span>**重要**</span>` on a line of its own showed as a block, its
 * stars as written.
 */
export const htmlFlowParse = $remark(
  'nyamark-html-flow',
  () =>
    function () {
      const data = this.data();
      data.fromMarkdownExtensions ??= [];
      data.fromMarkdownExtensions.push({
        enter: {
          htmlFlow(token) {
            this.enter(
              { type: 'html', value: '', data: { block: true } },
              token
            );
            this.buffer();
          },
        },
      });
    }
);

/** `editor.config` hook: HTML keeps whether the file has it as a block. */
export function keepHtmlBlocks(ctx: Ctx) {
  ctx.update(htmlSchema.key, (base) => (schemaCtx) => {
    const schema = base(schemaCtx);
    return {
      ...schema,
      attrs: { ...schema.attrs, block: { default: false } },
      toDOM: (node) => {
        const [tag, attrs, ...content] = schema.toDOM?.(node) as [
          string,
          Record<string, unknown>,
          ...unknown[],
        ];
        const block = node.attrs.block ? { 'data-block': '' } : {};
        return [tag, { ...attrs, ...block }, ...content];
      },
      parseDOM: schema.parseDOM?.map((rule) =>
        typeof rule.tag === 'string'
          ? {
              ...rule,
              getAttrs: (dom: HTMLElement) => {
                const attrs = rule.getAttrs?.(dom);
                if (attrs === false) return false;
                return { ...attrs, block: dom.hasAttribute('data-block') };
              },
            }
          : rule
      ),
      parseMarkdown: {
        match: ({ type }) => type === 'html',
        runner: (state, node, type) => {
          state.addNode(type, {
            value: node.value as string,
            block: (node.data as { block?: boolean })?.block === true,
          });
        },
      },
    };
  });
}

/**
 * Milkdown models every HTML node as an inline atom. An HTML block reaches the
 * document alone in a paragraph, marked as a block (`htmlFlowParse`);
 * anything else is HTML inside running text, an element whole
 * (`inlineHtmlRuns`) or a tag whose element is not all there, which is shown
 * as source.
 */
export function isHtmlBlock(node: ProseNode): boolean {
  return (
    node.type.name === 'paragraph' &&
    node.childCount === 1 &&
    node.firstChild?.type.name === 'html' &&
    node.firstChild.attrs.block === true
  );
}

/**
 * The HTML block in the paragraph at `pos`, selected. The block is chosen
 * over its paragraph: a letter typed over it takes its place in the line, and
 * over the paragraph it ran the lines above and below into one.
 */
export function selectHtmlBlockAt(doc: ProseNode, pos: number): NodeSelection {
  return NodeSelection.create(doc, pos + 1);
}

/** Whether `selection` is an HTML block selected whole. */
export function isHtmlBlockSelected(selection: Selection): boolean {
  return (
    selection instanceof NodeSelection &&
    selection.node.type.name === 'html' &&
    isHtmlBlock(selection.$from.parent)
  );
}

/**
 * A caret beside an HTML block, in the paragraph that holds it, as a click in
 * the gap above the block put it, selects the block instead. Text typed there
 * joined the block's paragraph and turned the block into its source.
 */
export const htmlBlockSelection = $prose(
  () =>
    new Plugin({
      key: new PluginKey('nyamark/html-block-selection'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
        const { selection } = state;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return null;
        }
        const { $head } = selection;
        if (!isHtmlBlock($head.parent)) return null;
        return state.tr.setSelection(
          selectHtmlBlockAt(state.doc, $head.before())
        );
      },
    })
);

function isBlockHtml(view: EditorView, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos === undefined) return true;
  return isHtmlBlock(view.state.doc.resolve(pos).parent);
}

export const htmlBlockView = $view(htmlSchema.node, (ctx) => {
  return (initialNode, view, getPos) => {
    let node = initialNode;
    const block = isBlockHtml(view, getPos);
    const dom = document.createElement(block ? 'div' : 'span');
    dom.classList.add(block ? 'ny-html-block' : 'ny-html-inline');

    const preview: HTMLElement = document.createElement(block ? 'div' : 'span');
    preview.classList.add('ny-html-preview');

    const editor = block
      ? document.createElement('textarea')
      : document.createElement('input');
    editor.classList.add('ny-html-editor');
    editor.spellcheck = false;

    let renders = 0;
    const render = (value: string) => {
      const current = ++renders;
      // Parsed in a template, where nothing loads, so a local image never
      // asks the app's own address for itself first.
      const template = document.createElement('template');
      // The extensions the editor's plugins give its reader, there once
      // it is frozen, as reading a file freezes it.
      const reader = ctx.get(remarkCtx).freeze();
      const syntax = reader.data('micromarkExtensions') ?? [];
      template.innerHTML = sanitizeHtmlBlock(
        block ? value : inlineHtml(value, syntax)
      );
      const source = ctx.get(htmlImageSource.key);
      for (const [image, src] of holdLocalImages(template.content)) {
        void Promise.resolve(source(src))
          .catch(() => src)
          .then((url) => {
            if (renders === current) image.src = url;
          });
      }
      preview.replaceChildren(template.content);
      if (!block) {
        // Fixed to the window, it was drawn over the app's own controls.
        for (const element of preview.querySelectorAll<HTMLElement>(
          '[style]'
        )) {
          if (element.style.position === 'fixed') {
            element.style.removeProperty('position');
          }
        }
      }
      // A comment, or a closing tag on its own such as the `</details>` after
      // the folded content, shows nothing: the block stood as a blank gap that
      // no click could find. It shows its source instead. In running text, so
      // does a tag whose element is not all there, and an empty anchor.
      const blank = block
        ? !preview.querySelector('*') && !preview.textContent?.trim()
        : !preview.textContent?.trim() && !preview.querySelector(SHOWN_EMPTY);
      dom.classList.toggle('ny-html-source', blank);
      if (blank) preview.textContent = value;
    };
    render(node.attrs.value);
    editor.value = node.attrs.value;

    let focused = false;

    dom.appendChild(preview);
    dom.appendChild(editor);

    const updateDisplay = () => {
      preview.style.display = focused ? 'none' : '';
      editor.style.display = focused ? '' : 'none';
    };

    const autoResize = () => {
      if (editor instanceof HTMLInputElement) {
        editor.size = Math.max(editor.value.length, 1);
        return;
      }
      // From one row, the textarea's two by default stood a blank line under
      // a line of source. The height takes in the border.
      editor.rows = 1;
      editor.style.height = 'auto';
      const border = editor.offsetHeight - editor.clientHeight;
      editor.style.height = `${editor.scrollHeight + border}px`;
    };

    editor.addEventListener('input', autoResize);

    /** The source written back; a block emptied of it goes with its line. */
    const commit = () => {
      if (editor.value === node.attrs.value) return;
      const pos = getPos();
      if (pos === undefined) return;
      const { tr } = view.state;
      if (editor.value.trim()) {
        tr.setNodeAttribute(pos, 'value', editor.value);
      } else if (block) {
        const $pos = tr.doc.resolve(pos);
        tr.delete($pos.before(), $pos.after());
      } else {
        tr.delete(pos, pos + node.nodeSize);
      }
      view.dispatch(tr);
    };

    /**
     * Out of the source, back to the document: to the text past the block on
     * the side of `dir`, or with 0 onto the block, selected. A tag in running
     * text leaves the caret after it.
     */
    const leave = (dir: 1 | -1 | 0) => {
      const emptied = !editor.value.trim();
      editor.blur();
      const pos = getPos();
      if (!emptied && pos !== undefined) {
        const { doc } = view.state;
        const $pos = doc.resolve(pos);
        let target: Selection | null = null;
        if (!block) {
          target = TextSelection.create(doc, pos + node.nodeSize);
        } else if (dir !== 0) {
          const side = doc.resolve(dir > 0 ? $pos.after() : $pos.before());
          target = Selection.findFrom(side, dir, true);
        }
        target ??= selectHtmlBlockAt(doc, $pos.before());
        view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
      }
      view.focus();
    };

    // Escape, and Enter in a tag, end the editing; the arrows leave a block
    // past its first or last line, as they leave code.
    (editor as HTMLElement).addEventListener('keydown', (e) => {
      if (forInputMethod(e)) return;
      if (e.key === 'Escape' || (!block && e.key === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        leave(0);
        return;
      }
      if (!block || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const { value } = editor;
      const from = editor.selectionStart ?? 0;
      const to = editor.selectionEnd ?? value.length;
      if (from !== to) return;
      const up =
        (e.key === 'ArrowUp' && !value.slice(0, from).includes('\n')) ||
        (e.key === 'ArrowLeft' && from === 0);
      const down =
        (e.key === 'ArrowDown' && !value.slice(to).includes('\n')) ||
        (e.key === 'ArrowRight' && to === value.length);
      if (!up && !down) return;
      e.preventDefault();
      leave(up ? -1 : 1);
    });

    editor.addEventListener('blur', () => {
      focused = false;
      updateDisplay();
      commit();
    });

    editor.addEventListener('focus', () => {
      focused = true;
      updateDisplay();
      autoResize();
    });

    preview.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a')) {
        // Never let the webview follow the link itself; that would navigate
        // the privileged window away and sever the IPC bridge. Ctrl/Cmd-click
        // bubbles to the editor container, which opens it via the opener.
        e.preventDefault();
        // In running text the link is often all there is, as a citation's
        // `[5]` is, and a click on it opens the source as one on text does.
        if (block || e.metaKey || e.ctrlKey) return;
      }
      if (target.closest('summary, audio, video')) {
        return;
      }

      focused = true;
      updateDisplay();
      editor.focus();
      autoResize();
    });

    updateDisplay();
    autoResize();

    return {
      dom,
      update: (updatedNode) => {
        if (updatedNode.type.name !== node.type.name) return false;
        // Text typed next to a block, or a block left alone in its paragraph,
        // needs the other rendering; returning false recreates the view.
        if (isBlockHtml(view, getPos) !== block) return false;
        node = updatedNode;
        render(updatedNode.attrs.value);
        if (!focused) {
          editor.value = updatedNode.attrs.value;
          autoResize();
        }
        return true;
      },
      // Keys and mouse inside the editor belong to the editor. Without this
      // ProseMirror's keymap sees Enter, Backspace and Mod-Z first and edits
      // the document around the node instead of the HTML in it.
      stopEvent: (event) => editor.contains(event.target as Node),
      selectNode: () => {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode: () => {
        dom.classList.remove('ProseMirror-selectednode');
      },
      ignoreMutation: () => true,
    };
  };
});
