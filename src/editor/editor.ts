/**
 * Thin Crepe wrapper. Owns the editor lifecycle and the small public API
 * the rest of the app talks to. Mermaid theming, image meta panel, and GFM
 * alerts each live in their own module under `./plugins/`.
 */

import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose, outline, replaceAll } from '@milkdown/kit/utils';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import { buildCrepeConfig } from './config';
import { blockSelection } from './plugins/block-selection';
import { installDragSelectGuard } from './plugins/drag-guard';
import { gfmAlerts, registerGfmAlertStyles } from './plugins/gfm-alerts';
import { htmlBlockView, registerHtmlBlockStyles } from './plugins/html-block';
import { ImageMetaPanel } from './plugins/image-meta-panel';
import { bindMermaidThemeListener, configureMermaid } from './plugins/mermaid';
import { registerEditorStyles } from './styles';

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
  private detachMermaidThemeListener: (() => void) | null = null;
  private detachDragSelectGuard: (() => void) | null = null;
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
    this.detachMermaidThemeListener = bindMermaidThemeListener(this.root, () =>
      this.getView()
    );
    this.detachDragSelectGuard = installDragSelectGuard(this.root);

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

    crepe.editor.use(gfmAlerts);
    crepe.editor.use(htmlBlockView);
    crepe.editor.use(blockSelection);
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
   */
  /** Runs after every transaction that changed the document; returns the unsubscribe. */
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
  setMarkdown(markdown: string, options: { addToHistory?: boolean } = {}) {
    if (!this.crepe) return;
    if (options.addToHistory ?? true) {
      this.crepe.editor.action(replaceAll(markdown));
      return;
    }
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = ctx.get(parserCtx)(markdown);
      if (!doc) return;
      const { state } = view;
      view.dispatch(
        state.tr
          .replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
          .setMeta('addToHistory', false)
      );
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

  getStats() {
    if (!this.crepe) return { words: 0, lines: 1 };
    const view = this.crepe.editor.ctx.get(editorViewCtx);
    const text = view.state.doc.textContent.trim();
    const markdown = this.getMarkdown().replace(/\r\n/g, '\n');
    return {
      words: text ? text.split(/\s+/).length : 0,
      lines: markdown ? markdown.split('\n').length : 1,
    };
  }

  scrollToHeading(id: string) {
    if (!this.crepe) return;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  destroy() {
    this.detachMermaidThemeListener?.();
    this.detachMermaidThemeListener = null;
    this.detachDragSelectGuard?.();
    this.detachDragSelectGuard = null;
    this.imageMetaPanel.detach();
    if (this.crepe) {
      this.crepe.destroy();
      this.crepe = null;
    }
  }
}
