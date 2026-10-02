/**
 * Thin Crepe wrapper. Owns the editor lifecycle and the small public API
 * the rest of the app talks to. Mermaid theming, image meta panel, and GFM
 * alerts each live in their own module under `./plugins/`.
 */

import { Crepe } from '@milkdown/crepe';
import {
  editorViewCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core';
import {
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  insertImageInputRule,
  strongInputRule,
} from '@milkdown/kit/preset/commonmark';
import {
  remarkGFMPlugin,
  strikethroughInputRule,
} from '@milkdown/kit/preset/gfm';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose, outline } from '@milkdown/kit/utils';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import { buildCrepeConfig } from './config';
import { replaceChangedRange } from './doc-diff';
import { bareLinkInput } from './plugins/bare-link-input';
import { bareLinkParse, keepBareLinks, writeLink } from './plugins/bare-links';
import { blockArrows } from './plugins/block-arrows';
import { blockEdges, freeHeadingEdges } from './plugins/block-edges';
import { handleBlocksOnly } from './plugins/block-handle-blocks';
import { restHiddenBlockHandle } from './plugins/block-handle-rest';
import { blockKeys, dropWrapKeys } from './plugins/block-keys';
import { blockSelection } from './plugins/block-selection';
import { caretScroll } from './plugins/caret-scroll';
import { cjkBreaks } from './plugins/cjk-breaks';
import { codeBlockFromHtml } from './plugins/code-block-html';
import { codeKey } from './plugins/code-key';
import { fenceLanguageWord } from './plugins/code-language';
import { codePreview } from './plugins/code-preview';
import { compositionSettle } from './plugins/composition-settle';
import { ctrlArrows } from './plugins/ctrl-arrows';
import { installDragSelectGuard } from './plugins/drag-guard';
import { fenceInput } from './plugins/fence-input';
import { keepFloatingOffEdge } from './plugins/floating-gutter';
import { footnoteInput } from './plugins/footnote-input';
import { footnoteMark, footnoteNumber } from './plugins/footnote-mark';
import {
  alertMarkers,
  gfmAlerts,
  registerGfmAlertStyles,
} from './plugins/gfm-alerts';
import { headingInput } from './plugins/heading-input';
import { headingDigitKeys } from './plugins/heading-keys';
import { homeEnd } from './plugins/home-end';
import { hrInput } from './plugins/hr-input';
import {
  htmlBlockSelection,
  htmlBlockView,
  registerHtmlBlockStyles,
} from './plugins/html-block';
import { keepImageAlt } from './plugins/image-alt';
import { ImageMetaPanel } from './plugins/image-meta-panel';
import { imageRatio } from './plugins/image-ratio';
import { imageOwnTitle } from './plugins/image-title';
import { caretPastSelectedBlock, insertBlocks } from './plugins/insert-blocks';
import { languagePickerKeys } from './plugins/language-picker-keys';
import { languagePickerRoom } from './plugins/language-picker-room';
import { linkBox, restoreOnCancel } from './plugins/link-box';
import { linkInput } from './plugins/link-input';
import { linkKey } from './plugins/link-key';
import { typeOutsideLinks } from './plugins/link-mark';
import { listEnter } from './plugins/list-enter';
import { keepListItemSelected, listItemView } from './plugins/list-item-view';
import { listTab } from './plugins/list-tab';
import { marginClick } from './plugins/margin-click';
import { markCursor } from './plugins/mark-cursor';
import { markInput } from './plugins/mark-input';
import { markTogglesThroughout } from './plugins/mark-toggles';
import {
  displayWidth,
  forgetBullet,
  joinInTightItem,
  markdownOutput,
  writeRoot,
  writeText,
} from './plugins/markdown-output';
import { dollarInput, dollarTextParse } from './plugins/math-dollars';
import { mathInlineKeys } from './plugins/math-inline-keys';
import { bindMermaidThemeListener, configureMermaid } from './plugins/mermaid';
import { pasteIntoCell } from './plugins/paste-cell';
import { pasteCodeAsCode } from './plugins/paste-code';
import { pasteCodeEdges } from './plugins/paste-code-edges';
import { pasteOnEmptyLine } from './plugins/paste-line';
import { pasteLinkOverText } from './plugins/paste-link';
import { pasteTextLines } from './plugins/paste-text-lines';
import { plusLine } from './plugins/plus-line';
import { quoteEnter } from './plugins/quote-enter';
import { quoteInput } from './plugins/quote-input';
import {
  type SearchMeta,
  findMatches,
  searchKey,
  searchPlugin,
} from './plugins/search';
import { slashMenuRoom } from './plugins/slash-menu-room';
import { tabFocus } from './plugins/tab-focus';
import { keepCellAlignment } from './plugins/table-align';
import { tableCells } from './plugins/table-cells';
import { fitTopBar } from './plugins/top-bar-fit';
import { closeHeadingListOnKeys } from './plugins/top-bar-heading-list';
import { enterAfterTypedBlock } from './plugins/typed-block-enter';
import { undoByLine } from './plugins/undo-lines';
import { type BlockSpan, blockSpans } from './source-caret';
import { registerEditorStyles } from './styles';
import { countLines, countWords } from './text-stats';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

export type EditorAttachment = {
  kind: 'image' | 'file';
  href: string;
  label: string;
};

export type NyaEditorOptions = {
  onUploadFile?: (file: File) => Promise<string>;
  proxyDomURL?: (src: string) => Promise<string> | string;
};

export class NyaEditor {
  private crepe: Crepe | null = null;
  private readonly imageMetaPanel: ImageMetaPanel;
  private onChangeCallback?: (markdown: string) => void;
  private readonly docChangedListeners = new Set<() => void>();

  constructor(
    private readonly root: HTMLElement,
    private readonly options: NyaEditorOptions = {}
  ) {
    this.imageMetaPanel = new ImageMetaPanel(this.root, () => this.crepe);
  }

  async init(initialMarkdown = '') {
    registerEditorStyles();
    registerGfmAlertStyles();
    registerHtmlBlockStyles();

    configureMermaid(document.documentElement.dataset.theme === 'dark');
    // One editor lives as long as its window, so these are never torn down.
    bindMermaidThemeListener(this.root, () => this.getView());
    installDragSelectGuard(this.root);

    const crepe = new Crepe(
      buildCrepeConfig({
        root: this.root,
        defaultValue: initialMarkdown,
        onUpload: async (file) => {
          const upload = this.options.onUploadFile;
          return upload ? upload(file) : URL.createObjectURL(file);
        },
        proxyDomURL: (src) => {
          const resolver = this.options.proxyDomURL;
          return resolver ? resolver(src) : src;
        },
        getView: () => this.getView(),
      })
    );

    // `-` bullets and `---` rules, the markers most notes are written with;
    // remark's defaults rewrote every one of them to `*` on save. Text keeps
    // the underscores, hashes and ampersands it needs no escape for (see
    // markdown-output), and a link written bare stays bare (see bare-links).
    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        rule: '-' as const,
        handlers: {
          ...options.handlers,
          root: writeRoot,
          text: writeText,
          link: writeLink,
        },
        // remark asks the last of these first, and stops at an answer.
        join: [...(options.join ?? []), joinInTightItem, forgetBullet],
      }));
      // Table pipes line up by display width (see markdown-output), and a
      // strikethrough takes two tildes (see mark-input).
      ctx.update(remarkGFMPlugin.options.key, (options) => ({
        ...options,
        stringLength: displayWidth,
        singleTilde: false,
      }));
    });
    crepe.editor.config(keepImageAlt);
    crepe.editor.config(keepBareLinks);
    crepe.editor.config(typeOutsideLinks);
    crepe.editor.config(restoreOnCancel);
    crepe.editor.config(dropWrapKeys);
    crepe.editor.config(headingDigitKeys);
    crepe.editor.config(keepCellAlignment);
    crepe.editor.config(freeHeadingEdges);
    crepe.editor.config(handleBlocksOnly);
    crepe.editor.use(caretScroll);
    crepe.editor.use(markdownOutput);
    crepe.editor.use(dollarTextParse);
    crepe.editor.use(bareLinkParse);
    crepe.editor.use(gfmAlerts);
    crepe.editor.use(blockEdges);
    crepe.editor.use(hrInput);
    crepe.editor.use(quoteInput);
    crepe.editor.use(headingInput);
    crepe.editor.use(dollarInput);
    // Removed before the editor is created, so at once (see mark-input).
    void crepe.editor.remove([
      strongInputRule,
      emphasisStarInputRule,
      emphasisUnderscoreInputRule,
      insertImageInputRule,
      strikethroughInputRule,
    ]);
    crepe.editor.use(markInput);
    crepe.editor.use(markCursor);
    crepe.editor.use(cjkBreaks);
    crepe.editor.use(compositionSettle);
    crepe.editor.use(marginClick);
    crepe.editor.use(homeEnd);
    crepe.editor.use(ctrlArrows);
    crepe.editor.use(enterAfterTypedBlock);
    crepe.editor.use(undoByLine);
    crepe.editor.use(linkInput);
    crepe.editor.use(bareLinkInput);
    crepe.editor.use(footnoteInput);
    crepe.editor.use(footnoteMark);
    crepe.editor.use(footnoteNumber);
    crepe.editor.use(imageOwnTitle);
    crepe.editor.use(codeBlockFromHtml);
    crepe.editor.use(linkBox);
    crepe.editor.use(linkKey);
    crepe.editor.use(codeKey);
    crepe.editor.use(blockKeys);
    crepe.editor.use(slashMenuRoom);
    crepe.editor.use(plusLine);
    crepe.editor.use(fenceInput);
    crepe.editor.use(listEnter);
    crepe.editor.use(listTab);
    crepe.editor.use(quoteEnter);
    crepe.editor.use(listItemView);
    crepe.editor.use(keepListItemSelected);
    crepe.editor.use(pasteLinkOverText);
    crepe.editor.use(pasteOnEmptyLine);
    crepe.editor.use(pasteCodeAsCode);
    crepe.editor.use(pasteCodeEdges);
    crepe.editor.use(pasteTextLines);
    crepe.editor.use(pasteIntoCell);
    crepe.editor.use(mathInlineKeys);
    crepe.editor.use(htmlBlockView);
    crepe.editor.use(htmlBlockSelection);
    crepe.editor.use(blockSelection);
    crepe.editor.use(codePreview);
    crepe.editor.use(fenceLanguageWord);
    crepe.editor.use(blockArrows);
    crepe.editor.use(imageRatio);
    crepe.editor.use(tableCells);
    crepe.editor.use(tabFocus);
    crepe.editor.use(searchPlugin);
    crepe.editor.use(this.docChangedPlugin());

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown, prev) => {
        if (this.onChangeCallback && markdown !== prev) {
          this.onChangeCallback(markdown);
        }
      });
    });

    this.crepe = crepe;
    await crepe.create();
    crepe.editor.action(markTogglesThroughout);
    // The format bar reads the block at the caret only once the editor counts
    // as created, which comes after its first render: until the next update
    // it called the opening heading "Body".
    const view = this.getView();
    view?.dispatch(view.state.tr);
    this.imageMetaPanel.attach();
    keepFloatingOffEdge(this.root);
    restHiddenBlockHandle(this.root);
    fitTopBar(this.root);
    closeHeadingListOnKeys(this.root);
    languagePickerKeys(this.root);
    languagePickerRoom(this.root);
  }

  /**
   * Markdown-level change notification. Milkdown's listener plugin debounces
   * this by 200ms, so it suits statistics but must never gate a save.
   */
  onChange(callback: (markdown: string) => void) {
    this.onChangeCallback = callback;
  }

  /**
   * Fires synchronously as soon as a transaction changed the document, before
   * control returns to whoever dispatched it. Dirty tracking hangs off this
   * so a save or close prompt issued right after a keystroke sees the truth.
   * Returns the unsubscribe.
   */
  onDocChanged(callback: () => void): () => void {
    this.docChangedListeners.add(callback);
    return () => {
      this.docChangedListeners.delete(callback);
    };
  }

  private docChangedPlugin() {
    return $prose(
      () =>
        new Plugin({
          key: new PluginKey('nya-doc-changed'),
          view: () => ({
            update: (view, prevState) => {
              if (prevState.doc.eq(view.state.doc)) return;
              for (const listener of this.docChangedListeners) listener();
            },
          }),
        })
    );
  }

  getMarkdown(): string {
    return this.crepe ? this.crepe.getMarkdown() : '';
  }

  getView(): ProseMirrorEditorView | null {
    if (!this.crepe) return null;
    return this.crepe.editor.ctx.get(editorViewCtx);
  }

  isEmpty() {
    return this.getMarkdown().trim() === '';
  }

  /** Where each top-level block of `markdown` sits in it (see `source-caret`). */
  blockSpans(markdown: string): BlockSpan[] {
    if (!this.crepe) return [];
    return this.crepe.editor.action((ctx) => {
      const remark = ctx.get(remarkCtx);
      const tree = remark.runSync(remark.parse(markdown), markdown);
      return blockSpans(tree as Parameters<typeof blockSpans>[0]);
    });
  }

  /**
   * Replace the whole document. Content the user did not type (a reload
   * after the file changed on disk) passes `addToHistory: false` so Cmd+Z
   * cannot resurrect the pre-reload text and mark it dirty; the history
   * plugin maps the existing undo stack through the replacement instead.
   */
  /**
   * Replaces only the part of the document that differs, so the source pane's
   * debounced syncs become small undo steps (which ProseMirror's history then
   * groups) and the selection outside the edit stays put.
   */
  setMarkdown(markdown: string, options: { addToHistory?: boolean } = {}) {
    if (!this.crepe) return;
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = ctx.get(parserCtx)(markdown);
      if (!doc) return;
      const tr = replaceChangedRange(view.state.tr, doc);
      if (!tr.docChanged) return;
      if (!(options.addToHistory ?? true)) tr.setMeta('addToHistory', false);
      view.dispatch(tr);
    });
  }

  setReadonly(readonly: boolean) {
    if (!this.crepe) return;
    this.crepe.setReadonly(readonly);
  }

  getOutline() {
    if (!this.crepe) return [];
    return this.crepe.editor.action(outline());
  }

  /** Pass `markdown` when it is already at hand to skip serializing the document again. */
  getStats(markdown?: string) {
    if (!this.crepe) return { words: 0, lines: 1 };
    const view = this.crepe.editor.ctx.get(editorViewCtx);
    const { doc } = view.state;
    // `textContent` runs the blocks together; keep them apart.
    const text = doc.textBetween(0, doc.content.size, '\n', ' ');
    let words = countWords(text);
    // An alert's `[!NOTE]` shows as its label, which is no word of the text.
    for (const { from, to } of alertMarkers(doc)) {
      words -= countWords(doc.textBetween(from, to, '\n', ' '));
    }
    const source = markdown ?? this.getMarkdown();
    return { words, lines: countLines(source) };
  }

  /**
   * Scrolls heading `id` to the top and puts the caret at its end, so typing
   * after a jump from the outline goes on there. In source mode the caret
   * stays in the source, and the jump is instant: the source pane follows
   * the preview, and its first step stopped a smooth scroll near the start.
   */
  scrollToHeading(id: string) {
    const view = this.getView();
    if (!view) return;
    const sourceMode = view.dom.closest('.is-source-mode') != null;
    let end = -1;
    view.state.doc.descendants((node, pos) => {
      if (end >= 0) return false;
      if (node.type.name !== 'heading') return !node.isTextblock;
      if (node.attrs.id === id) end = pos + node.nodeSize - 1;
      return false;
    });
    if (end >= 0 && !sourceMode) {
      const { tr } = view.state;
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)));
      view.focus();
    }
    const smooth =
      !sourceMode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'start',
    });
  }

  /**
   * Highlights every match of `query` and selects one. `first` takes the
   * first match at or after the selection, so refining the query keeps the
   * current match while it still fits; `next` and `prev` step from the
   * current match and wrap.
   */
  search(query: string, direction: 'first' | 'next' | 'prev') {
    const view = this.getView();
    if (!view) return;
    const { state } = view;
    const matches = findMatches(state.doc, query);
    const total = matches.length;
    let active = -1;
    if (total > 0) {
      const previous = searchKey.getState(state);
      if (
        direction !== 'first' &&
        previous?.query === query &&
        previous.active >= 0
      ) {
        const step = direction === 'next' ? 1 : total - 1;
        active = (previous.active + step) % total;
      } else {
        const after = matches.findIndex(
          (match) => match.from >= state.selection.from
        );
        active = after === -1 ? 0 : after;
      }
    }
    const meta: SearchMeta = { query, matches, active };
    const tr = state.tr.setMeta(searchKey, meta);
    const match = matches[active];
    if (match) {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
    }
    view.dispatch(tr);
    if (match) this.revealMatch(view, match.from);
  }

  /**
   * Scrolls a match off screen to the middle of the page, the lines around it
   * being its context. ProseMirror scrolls to its selection only while it has
   * the focus, and the search field keeps it: stepping to a match above or
   * below the page left the page where it was.
   */
  private revealMatch(view: ProseMirrorEditorView, pos: number) {
    const scroller = view.dom.closest<HTMLElement>('.ny-shell__body');
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const top =
      box.top +
      (Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0);
    const match = view.coordsAtPos(pos);
    if (match.top >= top && match.bottom <= box.bottom) return;
    scroller.scrollTop +=
      (match.top + match.bottom) / 2 - (top + box.bottom) / 2;
  }

  /** The selected text when it lies within one line, else an empty string. */
  selectedLine(): string {
    const view = this.getView();
    if (!view) return '';
    const { from, to, $from, $to } = view.state.selection;
    if (from === to || !$from.sameParent($to)) return '';
    const text = view.state.doc.textBetween(from, to);
    return text.length <= 200 && !text.includes('\n') ? text : '';
  }

  /** The current match (1-based, 0 for none) and how many there are. */
  searchStatus() {
    const view = this.getView();
    const state = view ? searchKey.getState(view.state) : undefined;
    return {
      current: (state?.active ?? -1) + 1,
      total: state?.matches.length ?? 0,
    };
  }

  /**
   * Drops the highlights. The selection stays on the last match; editable
   * views take focus so typing continues there.
   */
  endSearch() {
    const view = this.getView();
    if (!view) return;
    const meta: SearchMeta = { query: '', matches: [], active: -1 };
    view.dispatch(view.state.tr.setMeta(searchKey, meta));
    if (view.editable) view.focus();
  }

  /** Puts the caret in the editor without moving it, ready for typing. */
  focus() {
    const view = this.getView();
    if (view?.editable) view.focus();
  }

  insertAttachments(attachments: EditorAttachment[]) {
    if (!this.crepe || attachments.length === 0) return;
    const view = this.crepe.editor.ctx.get(editorViewCtx);
    const { schema } = view.state;
    const imageNodeType = schema.nodes['image-block'] ?? schema.nodes.image;
    const paragraphType = schema.nodes.paragraph;
    const linkMarkType = schema.marks.link;

    const nodes = attachments.flatMap((attachment) => {
      if (attachment.kind === 'image') {
        if (!imageNodeType) return [];
        const imageNode =
          imageNodeType.name === 'image-block'
            ? imageNodeType.createAndFill({
                src: attachment.href,
                caption: attachment.label,
                ratio: 1,
              })
            : imageNodeType.createAndFill({
                src: attachment.href,
                alt: attachment.label,
                title: attachment.label,
              });
        return imageNode ? [imageNode] : [];
      }

      if (!paragraphType) return [];
      const marks = linkMarkType
        ? [
            linkMarkType.create({
              href: attachment.href,
              title: attachment.label,
            }),
          ]
        : [];
      return [paragraphType.create(null, schema.text(attachment.label, marks))];
    });

    if (!nodes.length) return;
    const images = nodes.every((node) => node.type.name === 'image-block');
    const placed = images ? insertBlocks(view.state, nodes) : null;
    const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
    const tr =
      placed ?? caretPastSelectedBlock(view.state.tr.replaceSelection(slice));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  /**
   * Run every image `src` and link `href` through `mapper` and apply the
   * values it returns (`null` keeps the original). Used when the document
   * moves so its references keep resolving from the new directory. Kept out
   * of the undo history: Cmd+Z cannot move the file back.
   */
  rewriteLocalReferences(mapper: (reference: string) => string | null) {
    if (!this.crepe) return 0;
    const view = this.crepe.editor.ctx.get(editorViewCtx);
    const { state } = view;
    const { tr } = state;
    const linkMarkType = state.schema.marks.link;
    let rewritten = 0;

    // Attribute and mark changes never move positions, so the positions of
    // the untouched document stay valid for the whole walk.
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image-block' || node.type.name === 'image') {
        const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
        const next = src ? mapper(src) : null;
        if (next !== null && next !== src) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
          rewritten += 1;
        }
      }

      if (!linkMarkType || !node.isInline) return true;
      for (const mark of node.marks) {
        if (mark.type !== linkMarkType) continue;
        const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
        const next = href ? mapper(href) : null;
        if (next === null || next === href) continue;
        const end = pos + node.nodeSize;
        tr.removeMark(pos, end, mark).addMark(
          pos,
          end,
          linkMarkType.create({ ...mark.attrs, href: next })
        );
        rewritten += 1;
      }
      return true;
    });

    if (rewritten > 0) view.dispatch(tr.setMeta('addToHistory', false));
    return rewritten;
  }
}
