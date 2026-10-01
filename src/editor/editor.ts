/**
 * Thin Crepe wrapper. Owns the editor lifecycle and the small public API
 * the rest of the app talks to. Mermaid theming, image meta panel, and GFM
 * alerts each live in their own module under `./plugins/`.
 */

import { Crepe } from '@milkdown/crepe';
import {
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose, outline } from '@milkdown/kit/utils';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import { buildCrepeConfig } from './config';
import { replaceChangedRange } from './doc-diff';
import { blockSelection } from './plugins/block-selection';
import { installDragSelectGuard } from './plugins/drag-guard';
import { gfmAlerts, registerGfmAlertStyles } from './plugins/gfm-alerts';
import { htmlBlockView, registerHtmlBlockStyles } from './plugins/html-block';
import { ImageMetaPanel } from './plugins/image-meta-panel';
import { markdownOutput } from './plugins/markdown-output';
import { bindMermaidThemeListener, configureMermaid } from './plugins/mermaid';
import {
  type SearchMeta,
  findMatches,
  searchKey,
  searchPlugin,
} from './plugins/search';
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
      })
    );

    // `-` bullets and `---` rules, the markers most notes are written with;
    // remark's defaults rewrote every one of them to `*` on save.
    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        rule: '-' as const,
      }));
    });
    crepe.editor.use(markdownOutput);
    crepe.editor.use(gfmAlerts);
    crepe.editor.use(htmlBlockView);
    crepe.editor.use(blockSelection);
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
    this.imageMetaPanel.attach();
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
    const source = markdown ?? this.getMarkdown();
    return {
      words: countWords(text),
      lines: countLines(source),
    };
  }

  scrollToHeading(id: string) {
    if (!this.crepe) return;
    document.getElementById(id)?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
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
      tr.scrollIntoView();
    }
    view.dispatch(tr);
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

  focusAtEnd() {
    if (!this.crepe) return;
    const view = this.crepe.editor.ctx.get(editorViewCtx);
    const selection = TextSelection.atEnd(view.state.doc);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    view.focus();
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
    const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
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
