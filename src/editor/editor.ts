/**
 * Thin Crepe wrapper. Owns the editor lifecycle and the small public API
 * the rest of the app talks to. Mermaid theming, image meta panel, and GFM
 * alerts each live in their own module under `./plugins/`.
 */

import { Crepe } from '@milkdown/crepe';
import {
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { listener } from '@milkdown/kit/plugin/listener';
import { trailingConfig } from '@milkdown/kit/plugin/trailing';
import {
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  headingIdGenerator,
  inlineCodeInputRule,
  insertImageInputRule,
  strongInputRule,
} from '@milkdown/kit/preset/commonmark';
import {
  keepTableAlignPlugin,
  remarkGFMPlugin,
  strikethroughInputRule,
} from '@milkdown/kit/preset/gfm';
import {
  Fragment,
  type Node as ProseNode,
  Slice,
} from '@milkdown/kit/prose/model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import { buildCrepeConfig } from './config';
import {
  replaceChangedRange,
  replaceChangedRuns,
  settleParsed,
} from './doc-diff';
import { type DocCounts, DocStats } from './doc-stats';
import { anchorIndex, headingId, headingLabel, pageId } from './heading-anchor';
import { afterFirstFrame, openingOf } from './open-in-parts';
import {
  ORIGIN_META,
  aiProposals,
  proposalState,
} from './plugins/ai-proposals';
import { aiSuggest } from './plugins/ai-suggest';
import { bareLinkInput } from './plugins/bare-link-input';
import { bareLinkParse, keepBareLinks } from './plugins/bare-links';
import { blockArrows } from './plugins/block-arrows';
import { blockEdges, freeHeadingEdges } from './plugins/block-edges';
import { handleBlocksOnly } from './plugins/block-handle-blocks';
import { restHiddenBlockHandle } from './plugins/block-handle-rest';
import { blockKeys, dropWrapKeys } from './plugins/block-keys';
import { blockSelection } from './plugins/block-selection';
import { caretScroll } from './plugins/caret-scroll';
import { cjkBreaks } from './plugins/cjk-breaks';
import { cjkEmphasis, cjkStrikethrough } from './plugins/cjk-emphasis';
import { codeKey } from './plugins/code-key';
import { fenceLanguageWord } from './plugins/code-language';
import { codePreview } from './plugins/code-preview';
import { codeLineBox } from './plugins/code-search';
import { compositionSettle } from './plugins/composition-settle';
import { ctrlArrows } from './plugins/ctrl-arrows';
import { installDragSelectGuard } from './plugins/drag-guard';
import { fenceInput } from './plugins/fence-input';
import { keepFloatingOffEdge } from './plugins/floating-gutter';
import { footnoteInput } from './plugins/footnote-input';
import { footnoteMark, footnoteNumber } from './plugins/footnote-mark';
import {
  frontMatterBlock,
  frontMatterSyntax,
  pastFrontMatter,
} from './plugins/front-matter';
import { gfmAlerts, registerGfmAlertStyles } from './plugins/gfm-alerts';
import { headingOneLine, headingShiftEnter } from './plugins/heading-break';
import { headingInput } from './plugins/heading-input';
import { headingDigitKeys } from './plugins/heading-keys';
import { homeEnd } from './plugins/home-end';
import { hrInput, ruleOnEnter } from './plugins/hr-input';
import {
  htmlBlockSelection,
  htmlBlockView,
  htmlImageSource,
  htmlReferencesMapped,
  registerHtmlBlockStyles,
} from './plugins/html-block';
import { imageAddressCaret } from './plugins/image-address-caret';
import { keepImageAlt } from './plugins/image-alt';
import { ImageMetaPanel } from './plugins/image-meta-panel';
import { imageRatio } from './plugins/image-ratio';
import { imageOwnTitle } from './plugins/image-title';
import { inlineCodeText } from './plugins/inline-code-text';
import { inlineHtmlRuns } from './plugins/inline-html';
import { caretPastSelectedBlock, insertBlocks } from './plugins/insert-blocks';
import { languagePickerKeys } from './plugins/language-picker-keys';
import { languagePickerRoom } from './plugins/language-picker-room';
import { linkBox, restoreOnCancel } from './plugins/link-box';
import { linkDefinitions } from './plugins/link-definitions';
import { linkInput } from './plugins/link-input';
import { linkKey } from './plugins/link-key';
import { typeOutsideLinks, writeLinksAround } from './plugins/link-mark';
import { listEnter } from './plugins/list-enter';
import { keepListItemSelected, listItemView } from './plugins/list-item-view';
import { listKinds } from './plugins/list-kinds';
import { listTab } from './plugins/list-tab';
import { marginClick } from './plugins/margin-click';
import { markCursor } from './plugins/mark-cursor';
import { markTogglesThroughout } from './plugins/mark-toggles';
import {
  displayWidth,
  markdownOutput,
  writeAsNotes,
} from './plugins/markdown-output';
import { dollarInput, dollarTextParse } from './plugins/math-dollars';
import { mathInlineKeys } from './plugins/math-inline-keys';
import {
  bindMermaidThemeListener,
  configureMermaid,
  drawDiagramsForPrint,
  followTheme,
  showMermaidPictures,
} from './plugins/mermaid';
import { pasteIntoCell } from './plugins/paste-cell';
import { pasteCodeAsCode } from './plugins/paste-code';
import { pasteCodeEdges } from './plugins/paste-code-edges';
import { pasteOnEmptyLine } from './plugins/paste-line';
import { pasteLinkOverText } from './plugins/paste-link';
import { pasteTextLines } from './plugins/paste-text-lines';
import { pasteWordLists } from './plugins/paste-word-lists';
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
import { keepCellAlignment, keepTableAlign } from './plugins/table-align';
import { tableCells } from './plugins/table-cells';
import { keepPastedTasks } from './plugins/task-paste';
import { fitTopBar } from './plugins/top-bar-fit';
import { keepFocusOffBar } from './plugins/top-bar-focus';
import { markCaretInCode } from './plugins/top-bar-heading-code';
import { closeHeadingListOnKeys } from './plugins/top-bar-heading-list';
import { typeOverBlocks } from './plugins/type-over-blocks';
import { enterAfterTypedBlock } from './plugins/typed-block-enter';
import { typedMarksInput } from './plugins/typed-marks';
import { undoByLine } from './plugins/undo-lines';
import { scrollIntoViewSettled } from './scroll-settled';
import { type BlockSpan, blockSpans } from './source-caret';
import { registerEditorStyles } from './styles';

import './styles/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import './styles/crepe-cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import './styles/crepe-toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/common/latex.css';
import '@milkdown/crepe/theme/common/top-bar.css';
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
  private readonly stats = new DocStats((doc) => this.serializeDoc(doc));
  private readonly docChangedListeners = new Set<() => void>();
  private markReady: () => void = () => {};
  private readonly ready = new Promise<void>((resolve) => {
    this.markReady = resolve;
  });

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
    showMermaidPictures(this.root);
    installDragSelectGuard(this.root);

    // A long document opens on its first screens, and stays closed to
    // editing until the rest is drawn (see open-in-parts).
    const opening = openingOf(initialMarkdown);
    let opened = opening === null;
    const crepe = new Crepe(
      buildCrepeConfig({
        root: this.root,
        defaultValue: opening ?? initialMarkdown,
        onUpload: async (file) => {
          const upload = this.options.onUploadFile;
          return upload ? upload(file) : URL.createObjectURL(file);
        },
        proxyDomURL: (src) => this.imageSource(src),
        getView: () => this.getView(),
      })
    );

    crepe.editor.config(writeAsNotes);
    crepe.editor.config((ctx) => {
      // Table pipes line up by display width (see markdown-output), and a
      // strikethrough takes two tildes (see cjk-emphasis).
      ctx.update(remarkGFMPlugin.options.key, (options) => ({
        ...options,
        stringLength: displayWidth,
        singleTilde: false,
      }));
      // A heading of a formula or an image alone gets an id on the page too.
      ctx.set(headingIdGenerator.key, headingId);
    });
    crepe.editor.config(keepImageAlt);
    crepe.editor.config(keepBareLinks);
    crepe.editor.config(typeOutsideLinks);
    crepe.editor.config(writeLinksAround);
    crepe.editor.config(restoreOnCancel);
    crepe.editor.config(dropWrapKeys);
    crepe.editor.config(headingDigitKeys);
    crepe.editor.config(keepCellAlignment);
    crepe.editor.config(keepPastedTasks);
    crepe.editor.config(freeHeadingEdges);
    crepe.editor.config(handleBlocksOnly);
    // First, so its keys come before Tab's and Mod-→'s own while a
    // suggestion shows.
    crepe.editor.use(aiSuggest);
    crepe.editor.use(caretScroll);
    crepe.editor.use(typeOverBlocks);
    crepe.editor.use(markdownOutput);
    crepe.editor.use(frontMatterSyntax);
    crepe.editor.use(linkDefinitions);
    crepe.editor.use(cjkEmphasis);
    crepe.editor.use(cjkStrikethrough);
    crepe.editor.use(dollarTextParse);
    crepe.editor.use(bareLinkParse);
    crepe.editor.use(inlineHtmlRuns);
    crepe.editor.use(gfmAlerts);
    crepe.editor.use(blockEdges);
    crepe.editor.use(hrInput);
    crepe.editor.use(ruleOnEnter);
    crepe.editor.use(quoteInput);
    crepe.editor.use(headingInput);
    crepe.editor.use(dollarInput);
    // Removed before the editor is created, so at once.
    void crepe.editor.remove([
      strongInputRule,
      inlineCodeInputRule,
      emphasisStarInputRule,
      emphasisUnderscoreInputRule,
      insertImageInputRule,
      strikethroughInputRule,
      keepTableAlignPlugin,
      listener,
    ]);
    crepe.editor.use(keepTableAlign);
    crepe.editor.use(typedMarksInput);
    crepe.editor.use(markCursor);
    crepe.editor.use(inlineCodeText);
    crepe.editor.use(cjkBreaks);
    crepe.editor.use(compositionSettle);
    crepe.editor.use(marginClick);
    crepe.editor.use(homeEnd);
    crepe.editor.use(ctrlArrows);
    crepe.editor.use(enterAfterTypedBlock);
    crepe.editor.use(headingShiftEnter);
    crepe.editor.use(headingOneLine);
    crepe.editor.use(undoByLine);
    crepe.editor.use(linkInput);
    crepe.editor.use(bareLinkInput);
    crepe.editor.use(footnoteInput);
    crepe.editor.use(footnoteMark);
    crepe.editor.use(footnoteNumber);
    crepe.editor.use(imageOwnTitle);
    crepe.editor.use(frontMatterBlock);
    crepe.editor.use(linkBox);
    crepe.editor.use(linkKey);
    crepe.editor.use(codeKey);
    crepe.editor.use(blockKeys);
    crepe.editor.use(slashMenuRoom);
    crepe.editor.use(plusLine);
    crepe.editor.use(fenceInput);
    crepe.editor.use(listEnter);
    crepe.editor.use(listTab);
    crepe.editor.use(listKinds);
    crepe.editor.use(quoteEnter);
    crepe.editor.use(listItemView);
    crepe.editor.use(keepListItemSelected);
    crepe.editor.use(pasteLinkOverText);
    crepe.editor.use(pasteOnEmptyLine);
    crepe.editor.use(pasteCodeAsCode);
    crepe.editor.use(pasteCodeEdges);
    crepe.editor.use(markCaretInCode);
    crepe.editor.use(pasteTextLines);
    crepe.editor.use(pasteIntoCell);
    crepe.editor.use(pasteWordLists);
    crepe.editor.use(mathInlineKeys);
    crepe.editor.use(htmlImageSource);
    crepe.editor.config((ctx) =>
      ctx.set(htmlImageSource.key, (src) => this.imageSource(src))
    );
    crepe.editor.use(htmlBlockView);
    crepe.editor.use(htmlBlockSelection);
    crepe.editor.use(blockSelection);
    crepe.editor.use(codePreview);
    crepe.editor.use(fenceLanguageWord);
    crepe.editor.use(blockArrows);
    crepe.editor.use(imageRatio);
    crepe.editor.use(imageAddressCaret);
    crepe.editor.use(tableCells);
    crepe.editor.use(tabFocus);
    crepe.editor.use(searchPlugin);
    crepe.editor.use(aiProposals);
    crepe.editor.use(this.docChangedPlugin());

    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        editable: (state) => opened && (options.editable?.(state) ?? true),
      }));
    });

    this.crepe = crepe;
    await crepe.create();
    crepe.editor.action(markTogglesThroughout);
    // The format bar reads the block at the caret only once the editor counts
    // as created, which comes after its first render: until the next update
    // it called the opening heading "Body". The caret starts past any front
    // matter, on the first line of the text.
    const view = this.getView();
    view?.dispatch(pastFrontMatter(view.state.tr));
    view?.dom.style.setProperty('outline-style', 'none');
    this.imageMetaPanel.attach();
    keepFloatingOffEdge(this.root);
    restHiddenBlockHandle(this.root);
    fitTopBar(this.root);
    keepFocusOffBar(this.root);
    closeHeadingListOnKeys(this.root);
    languagePickerKeys(this.root);
    languagePickerRoom(this.root);

    if (view && !opened) {
      await afterFirstFrame();
      // The text in full, drawn past the opening, which it leaves as drawn.
      if (!view.isDestroyed) {
        this.setMarkdown(initialMarkdown, { addToHistory: false });
      }
      opened = true;
      if (!view.isDestroyed) view.setProps({});
    }
    this.markReady();
  }

  /** Resolves once the whole document is in the editor (see open-in-parts). */
  whenReady(): Promise<void> {
    return this.ready;
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

  /** The address the webview loads the image at `src` from. */
  imageSource(src: string) {
    const resolver = this.options.proxyDomURL;
    return resolver ? resolver(src) : src;
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

  drawDiagramsForPrint(): Promise<void> {
    return drawDiagramsForPrint(this.getView());
  }

  followTheme(all = false): Promise<void> {
    return followTheme(this.root, this.getView(), all);
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
   * `markdown` as the editor would hold it: parsed, each heading given its
   * id and the trailing paragraph added (see `settleParsed`). Null when the
   * editor is not up yet.
   */
  parseMarkdown(markdown: string): ProseNode | null {
    if (!this.crepe) return null;
    return this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parsed = ctx.get(parserCtx)(markdown);
      if (!parsed) return null;
      const { shouldAppend, getNode } = ctx.get(trailingConfig.key);
      return settleParsed(parsed, ctx.get(headingIdGenerator.key), (last) =>
        shouldAppend(last, view.state) ? getNode(view.state) : undefined
      );
    });
  }

  /** `doc` written as Markdown, as a save would write it. */
  serializeDoc(doc: ProseNode): string {
    if (!this.crepe) return '';
    return this.crepe.editor.ctx.get(serializerCtx)(doc);
  }

  /**
   * Replaces only the part of the document that differs, so the source pane's
   * debounced syncs become small undo steps (which ProseMirror's history then
   * groups) and the selection outside the edit stays put. Content the user
   * did not type (a reload after the file changed on disk) passes
   * `addToHistory: false` so Cmd+Z cannot resurrect the pre-reload text and
   * mark it dirty; the history plugin maps the existing undo stack through
   * the replacement instead. `origin` tells the assistant's proposals what
   * changed the text under them.
   */
  setMarkdown(
    markdown: string,
    options: { addToHistory?: boolean; origin?: 'source' | 'reload' } = {}
  ) {
    const view = this.getView();
    const doc = this.parseMarkdown(markdown);
    if (!view || !doc) return;
    const addToHistory = options.addToHistory ?? true;
    const start = view.state.doc.content.findDiffStart(doc.content);
    if (start == null) return;
    // Undone, a change puts the caret back where it was before it. The
    // source pane's edits left that wherever the preview last had it, the
    // top of the document most often, and Cmd+Z back in the editor jumped
    // there: the caret goes to the change first.
    if (addToHistory) {
      view.dispatch(
        view.state.tr.setSelection(
          Selection.near(view.state.doc.resolve(start))
        )
      );
    }
    // With proposals pending, the blocks between two changes are left as
    // they are, and the proposals in them with them.
    const tr = proposalState(view.state)?.hunks.length
      ? replaceChangedRuns(view.state.tr, doc)
      : replaceChangedRange(view.state.tr, doc);
    if (!tr.docChanged) return;
    if (!addToHistory) tr.setMeta('addToHistory', false);
    if (options.origin) tr.setMeta(ORIGIN_META, options.origin);
    view.dispatch(tr);
  }

  setReadonly(readonly: boolean) {
    if (!this.crepe) return;
    this.crepe.setReadonly(readonly);
  }

  /** The headings with anything to show, by their label and page id. */
  getOutline() {
    const items: { text: string; level: number; id: string }[] = [];
    this.getView()?.state.doc.descendants((node) => {
      if (node.type.name !== 'heading') return !node.isTextblock;
      const text = headingLabel(node);
      if (text) items.push({ text, level: node.attrs.level, id: pageId(node) });
      return false;
    });
    return items;
  }

  getStats(): DocCounts {
    const doc = this.getView()?.state.doc;
    return doc ? this.stats.count(doc) : { words: 0, lines: 1 };
  }

  /** Where the text of heading `id` ends, or -1 when none has that id. */
  headingEnd(id: string) {
    let end = -1;
    this.getView()?.state.doc.descendants((node, pos) => {
      if (end >= 0) return false;
      if (node.type.name !== 'heading') return !node.isTextblock;
      if (pageId(node) === id) end = pos + node.nodeSize - 1;
      return false;
    });
    return end;
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
    const end = this.headingEnd(id);
    if (end >= 0 && !sourceMode) {
      const { tr } = view.state;
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)));
      view.focus();
    }
    const smooth =
      !sourceMode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heading = this.headingElement(id);
    if (heading) scrollIntoViewSettled(heading, 'start', smooth);
  }

  /**
   * The heading `id` names, on the page. Looked up in the document alone:
   * in the window, an element of the app's own with that id came first, the
   * app's root for a heading "App" and the title bar for "Titlebar".
   */
  headingElement(id: string): HTMLElement | null {
    if (!id) return null;
    return (
      this.getView()?.dom.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
      null
    );
  }

  /**
   * Goes to the heading a link to `#fragment` names, or else to the element
   * of HTML in the document with that id, as a citation's `#ref-5` names the
   * anchor of its reference. False when nothing has that anchor.
   */
  scrollToAnchor(fragment: string): boolean {
    const view = this.getView();
    if (!view) return false;
    const headings: ProseNode[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node);
      return !node.isTextblock;
    });
    const index = anchorIndex(
      headings.map((node) => node.textContent),
      fragment
    );
    const heading = headings[index];
    if (heading) {
      this.scrollToHeading(pageId(heading));
      return true;
    }
    return this.scrollToHtmlAnchor(fragment);
  }

  /** Goes to the element of HTML in the document whose id is `fragment`. */
  private scrollToHtmlAnchor(fragment: string): boolean {
    const view = this.getView();
    if (!view) return false;
    let id = fragment;
    try {
      id = decodeURIComponent(fragment);
    } catch {}
    const target = id
      ? view.dom.querySelector<HTMLElement>(
          `.ny-html-preview [id="${CSS.escape(id)}"]`
        )
      : null;
    if (!target) return false;
    // As at a heading: the caret beside it, or in source mode, where it is.
    const sourceMode = view.dom.closest('.is-source-mode') != null;
    if (!sourceMode) {
      const { tr } = view.state;
      const $pos = tr.doc.resolve(view.posAtDOM(target, 0));
      view.dispatch(tr.setSelection(Selection.near($pos)));
      view.focus();
    }
    const smooth =
      !sourceMode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollIntoViewSettled(target, 'center', smooth);
    return true;
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
    const match = codeLineBox(view, pos) ?? view.coordsAtPos(pos);
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
   * views take focus so typing continues there, the preview beside the
   * source pane aside.
   */
  endSearch() {
    const view = this.getView();
    if (!view) return;
    const meta: SearchMeta = { query: '', matches: [], active: -1 };
    view.dispatch(view.state.tr.setMeta(searchKey, meta));
    if (view.editable && !view.dom.closest('.is-source-mode')) view.focus();
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
    const { tr, rewritten } = referencesRewritten(view.state, mapper);
    if (rewritten > 0) view.dispatch(tr.setMeta('addToHistory', false));
    return rewritten;
  }

  /**
   * The Markdown the document reads with its references run through
   * `mapper` (see `rewriteLocalReferences`), the document left as it is.
   */
  getMarkdownWithReferences(mapper: (reference: string) => string | null) {
    if (!this.crepe) return '';
    const { ctx } = this.crepe.editor;
    const { tr } = referencesRewritten(ctx.get(editorViewCtx).state, mapper);
    return ctx.get(serializerCtx)(tr.doc);
  }
}

/**
 * `state` with every image `src` and link `href` run through `mapper`, those
 * written in HTML too.
 */
function referencesRewritten(
  state: EditorState,
  mapper: (reference: string) => string | null
) {
  const { tr } = state;
  const linkMarkType = state.schema.marks.link;
  let rewritten = 0;

  // Attribute and mark changes never move positions, so the positions of
  // the untouched document stay valid for the whole walk.
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'html') {
      const value = String(node.attrs.value ?? '');
      const next = htmlReferencesMapped(value, mapper);
      if (next !== value) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: next });
        rewritten += 1;
      }
      return false;
    }

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

  return { tr, rewritten };
}
