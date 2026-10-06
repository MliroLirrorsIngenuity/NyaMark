/**
 * Split-view "source mode": raw markdown in CodeMirror on the left,
 * read-only Crepe rendering on the right. Driven by `store.sourceMode`.
 *
 * Bidirectional sync deliberately stays one-directional — the right pane is
 * read-only because we only enter source mode as an "escape hatch" to inspect
 * or hand-tune the raw markdown. Re-entering WYSIWYG flushes the CM contents
 * back into the editor.
 *
 * Layout strategy:
 *  - we toggle `.is-source-mode` on `#ny-editor-container` AND on its parent
 *    scroll body so the `:has()` rule isn't required for older WebViews,
 *  - the editor container becomes a 50/50 grid that stretches to the body's
 *    height; each pane owns its own scroll so the code pane stays anchored
 *    at the top regardless of how long the rendered preview gets.
 */

import { autocompletion } from '@codemirror/autocomplete';
import { indentWithTab, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
} from '@codemirror/state';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { EditorView, basicSetup } from 'codemirror';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import type { Store } from '../state/store';
import { ensureStyle } from '../style/register';
import { textChange } from './doc-diff';
import type { NyaEditor } from './editor';
import { headingKey, syncedScrollTop } from './scroll-sync';
import { docPosition, sourceOffset } from './source-caret';
import { applyChanges, rewriteBlocks } from './source-follow';
import { continueMarkup } from './source-list-exit';
import { sourceSearch } from './source-search';
import { sourceSuggest } from './source-suggest';

/** A pause in typing this long brings the preview up to date. */
const SYNC_DELAY_MS = 180;

type SourceAnchor = {
  from: number;
  key: string;
};

type PreviewAnchor = {
  dom: HTMLElement;
  key: string;
};

const css = `
.ny-shell__body.is-source-mode-host {
  overflow: hidden;
  display: flex;
  min-height: 0;
}

#ny-editor-container.is-source-mode {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 0;
  width: 100%;
  height: 100%;
  flex: 1 1 0;
  max-width: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  min-height: 0;
}

#ny-editor-container.is-source-mode > .ny-source-pane,
#ny-editor-container.is-source-mode > .milkdown {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

#ny-editor-container.is-source-mode > .ny-source-pane {
  grid-column: 1;
  border-right: 1px solid var(--ny-editor-panel-border, rgba(186, 196, 210, 0.6));
  background: transparent;
}

#ny-editor-container.is-source-mode > .milkdown {
  grid-column: 2;
}

#ny-editor-container.is-source-mode > .milkdown > *:not(.ProseMirror) {
  display: none !important;
}

#ny-editor-container.is-source-mode > .milkdown .ProseMirror {
  user-select: text;
  cursor: default;
  pointer-events: none;
  padding-top: 16px !important;
  padding-bottom: 16px !important;
}

/*
 * A code block in the preview shows no tool pill, so its first line runs on
 * as the others do. It wrapped short of the room kept for a pill that never
 * came, in a pane half as wide.
 */
#ny-editor-container.is-source-mode
  > .milkdown
  .milkdown-code-block
  .cm-content
  > .cm-line:first-child {
  padding-right: 2px !important;
}

.ny-source-pane {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.ny-source-pane .cm-editor,
.ny-source-pane .cm-gutters,
.ny-source-pane .cm-scroller {
  background-color: transparent !important;
}

.ny-source-pane .cm-editor {
  flex: 1;
  height: 100%;
  font-family: var(--ny-font-mono);
  /* As a code block's: larger with the text, from 13px at the default. */
  font-size: max(13px, calc(13em / 14));
  line-height: 1.45;
  outline: none;
}

/*
 * CodeMirror's own style sets the scroller in the generic monospace, which
 * Windows in Chinese draws in the serif NSimSun.
 */
.ny-source-pane .cm-editor .cm-scroller {
  padding: 0;
  font-family: var(--ny-font-mono);
}

.ny-source-pane .cm-content {
  padding: 16px 12px;
}

.ny-source-pane .cm-gutters {
  border-right: 1px solid var(--ny-editor-panel-border, rgba(186, 196, 210, 0.6)) !important;
  min-width: 45px;
  color: color-mix(in srgb, var(--ny-text-secondary) 80%, transparent);
}

.ny-source-pane .cm-gutter {
  background-color: transparent !important;
}

/*
 * The active line's band runs from the edge of the pane to the divider and on
 * from it: the gutter's last column fills the gutter, and the lines carry the
 * content's side padding, which a line's band does not cover.
 */
.ny-source-pane .cm-gutter:last-child {
  flex-grow: 1;
}

/*
 * The arrows of the lines that fold show while the pointer is over the
 * gutter: one beside every heading, list, quote and fence crowded the line
 * numbers. A folded line keeps its arrow, to be opened again.
 */
.ny-source-pane .cm-foldGutter span[title="Fold line"] {
  opacity: 0;
  transition: opacity 120ms ease;
}

.ny-source-pane .cm-gutters:hover .cm-foldGutter span[title="Fold line"] {
  opacity: 1;
}

/* One band across both: CodeMirror's own pair are two different blues. */
.ny-source-pane :is(.cm-activeLine, .cm-activeLineGutter) {
  background-color: var(--ny-editor-active-line) !important;
}

.ny-source-pane .cm-content {
  padding-inline: 0;
}

.ny-source-pane .cm-content .cm-line {
  padding: 0 14px 0 18px;
}

.ny-source-pane .cm-content {
  caret-color: var(--ny-editor-text-primary);
}
`;

/**
 * Markdown colours from the app's own tokens, so both themes follow them.
 * CodeMirror's default style underlined every heading and link, which in a
 * page of markdown read as a wall of links.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--ny-editor-heading)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--ny-accent)' },
  { tag: tags.monospace, color: 'var(--ny-editor-code-text)' },
  { tag: tags.quote, color: 'var(--ny-text-secondary)' },
  {
    // `#`, `*`, `>`, `[x]`, fences, rules, escapes and html tags.
    tag: [
      tags.processingInstruction,
      tags.contentSeparator,
      tags.labelName,
      tags.atom,
      tags.escape,
      tags.meta,
      tags.comment,
      tags.angleBracket,
      tags.tagName,
      tags.attributeName,
      tags.attributeValue,
    ],
    color: 'var(--ny-editor-marker)',
  },
]);

function registerSourceModeStyles() {
  ensureStyle('editor-source-mode', css);
}

const HEADINGS = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
]);

function buildSourceAnchors(
  state: EditorState,
  keyOf: (source: string) => string
): SourceAnchor[] {
  const anchors: SourceAnchor[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!HEADINGS.has(node.name)) return;
      const source = state.doc.sliceString(node.from, node.to);
      anchors.push({ from: node.from, key: keyOf(source) });
      return false;
    },
  });
  return anchors;
}

function buildPreviewAnchors(view: ProseMirrorEditorView): PreviewAnchor[] {
  const anchors: PreviewAnchor[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return !node.isTextblock;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      anchors.push({ dom, key: headingKey(node.textContent) });
    }
    return false;
  });
  return anchors;
}

function paneContentTop(scrollPane: HTMLElement, element: HTMLElement) {
  const paneRect = scrollPane.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return scrollPane.scrollTop + (rect.top - paneRect.top);
}

export class SourceModeController {
  private host: HTMLElement | null = null;
  private cmView: EditorView | null = null;
  private previewView: ProseMirrorEditorView | null = null;
  private cmThemeCompartment = new Compartment();
  private syncTimer: number | null = null;
  /** CodeMirror text as of the last push into Crepe; edits since are pending. */
  private lastSyncedText = '';
  /** Set while CodeMirror is being overwritten from the editor side. */
  private applyingEditorText = false;
  private active = false;
  /** The pane the reader last reached for; only it leads the other. */
  private activeScrollSource: HTMLElement | null = null;
  /** Aborts the scroll-sync listeners of the current source-mode session. */
  private scrollSyncAbort: AbortController | null = null;
  private anchorsDirty = true;
  private sourceAnchors: SourceAnchor[] = [];
  private previewAnchors: PreviewAnchor[] = [];
  private headingKeys = new Map<string, string>();

  constructor(
    private readonly editorRoot: HTMLElement,
    private readonly editor: NyaEditor,
    private readonly store: Store
  ) {}

  init() {
    registerSourceModeStyles();

    let last = this.store.getState().sourceMode;
    this.store.subscribe((state) => {
      if (state.sourceMode === last) return;
      last = state.sourceMode;
      if (state.sourceMode) this.enter();
      else this.exit();
    });

    window.addEventListener('nyamark:themechange', () => {
      if (!this.cmView) return;
      this.cmView.dispatch({
        effects: this.cmThemeCompartment.reconfigure(this.themeExtension()),
      });
    });
  }

  /**
   * Takes the source pane to heading `id`, the caret at the end of its line
   * and the line at the top, and the preview after it. Scrolled alone, the
   * preview left the source where it was, and the next key typed there
   * took the preview back. False outside source mode.
   */
  revealHeading(id: string) {
    const cm = this.cmView;
    const view = this.previewView;
    if (!cm || !view) return false;
    this.flush();
    const end = this.editor.headingEnd(id);
    if (end < 0) return false;
    const text = cm.state.doc.toString();
    const spans = this.editor.blockSpans(text);
    const line = cm.state.doc.lineAt(
      sourceOffset(view.state.doc, end, text, spans, -1)
    );
    this.markScrollSource(cm.scrollDOM);
    cm.dispatch({
      selection: { anchor: line.to },
      effects: EditorView.scrollIntoView(line.from, {
        y: 'start',
        yMargin: 24,
      }),
    });
    cm.focus();
    return true;
  }

  /**
   * The source pane's selection as positions in the editor's document, its
   * edits pushed there first; null outside source mode.
   */
  selectionInDocument(): { from: number; to: number } | null {
    const cm = this.cmView;
    const view = this.previewView;
    if (!cm || !view) return null;
    this.flush();
    const text = cm.state.doc.toString();
    const spans = this.editor.blockSpans(text);
    const { from, to } = cm.state.selection.main;
    const { doc } = view.state;
    return {
      from: docPosition(doc, from, text, spans),
      to: docPosition(doc, to, text, spans),
    };
  }

  /** Opens the source pane's own find bar; false outside source mode. */
  find() {
    if (!this.cmView) return false;
    openSearchPanel(this.cmView);
    return true;
  }

  /**
   * Push edits still sitting in the sync debounce into the editor right now.
   * Anything that snapshots the document (save, close prompt) calls this
   * first so the last few keystrokes typed in the source pane are included.
   */
  flush() {
    if (this.syncTimer != null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (!this.cmView) return;
    const text = this.cmView.state.doc.toString();
    if (text === this.lastSyncedText) return;
    this.lastSyncedText = text;
    this.editor.setMarkdown(text, { origin: 'source' });
    this.invalidateAnchors();
  }

  /**
   * The editor's document changed from outside the source pane by a change
   * of its own (the assistant's edits accepted), from `before`, which the
   * pane's text read as. The pane follows in one undo step of its own: the
   * blocks that changed are written anew and the rest left as typed, unless
   * that would not read back the same, when the whole text follows.
   */
  followEditor(before: ProseNode) {
    const cm = this.cmView;
    const view = this.previewView;
    if (!cm || !view) return;
    if (this.syncTimer != null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    const current = cm.state.doc.toString();
    const after = view.state.doc;
    let changes =
      current === this.lastSyncedText
        ? rewriteBlocks(
            current,
            this.editor.blockSpans(current),
            before,
            after,
            (doc) => this.editor.serializeDoc(doc)
          )
        : null;
    let next = changes ? applyChanges(current, changes) : '';
    if (!changes || !this.editor.parseMarkdown(next)?.eq(after)) {
      next = this.editor.getMarkdown();
      changes = [textChange(current, next)];
    }
    this.lastSyncedText = next;
    if (next === current) return;
    this.applyingEditorText = true;
    try {
      cm.dispatch({
        changes,
        annotations: isolateHistory.of('full'),
      });
    } finally {
      this.applyingEditorText = false;
    }
    this.invalidateAnchors();
  }

  /**
   * The editor received a new document from outside the source pane (a reload
   * after the file changed on disk). CodeMirror follows, dropping whatever it
   * still held: the reload only happens once the editor was clean or the user
   * chose the disk version over their edits.
   */
  refreshFromEditor() {
    if (this.syncTimer != null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (!this.cmView) return;
    const text = this.editor.getMarkdown();
    this.lastSyncedText = text;
    const current = this.cmView.state.doc.toString();
    if (current === text) return;
    this.applyingEditorText = true;
    try {
      // Only what differs is replaced, and out of the undo history as in the
      // editor: swapping the whole text put the caret at the top, and Cmd+Z
      // brought back the text from before the reload.
      this.cmView.dispatch({
        changes: textChange(current, text),
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      this.applyingEditorText = false;
    }
    this.invalidateAnchors();
  }

  private themeExtension() {
    // The chrome only: the colours come from `markdownHighlight`.
    return document.documentElement.dataset.theme === 'dark'
      ? [oneDarkTheme]
      : [];
  }

  private invalidateAnchors() {
    this.anchorsDirty = true;
  }

  private markScrollSource(source: HTMLElement) {
    this.activeScrollSource = source;
  }

  private ensureAnchors() {
    if (!this.cmView || !this.previewView) return;
    if (!this.anchorsDirty) return;

    const known = this.headingKeys;
    const keys = new Map<string, string>();
    this.sourceAnchors = buildSourceAnchors(this.cmView.state, (source) => {
      const key =
        known.get(source) ?? headingKey(this.editor.markdownTree(source));
      keys.set(source, key);
      return key;
    });
    this.headingKeys = keys;
    this.previewAnchors = buildPreviewAnchors(this.previewView);
    this.anchorsDirty = false;
  }

  private enter() {
    if (this.active) return;
    this.active = true;

    const initialDoc = this.editor.getMarkdown();
    this.previewView = this.editor.getView();
    if (!this.previewView) {
      this.active = false;
      return;
    }
    this.lastSyncedText = initialDoc;

    // The caret and selection carry over from the editor (see `source-caret`).
    const spans = this.editor.blockSpans(initialDoc);
    const { doc, selection } = this.previewView.state;
    const toSource = (pos: number, side: -1 | 1) =>
      sourceOffset(doc, pos, initialDoc, spans, side);
    // A selection takes in the text it covers and none of the markup around.
    const from = toSource(selection.from, selection.empty ? -1 : 1);
    const to = Math.max(from, toSource(selection.to, -1));
    const range =
      selection.head < selection.anchor
        ? EditorSelection.single(to, from)
        : EditorSelection.single(from, to);

    // NOTE: we deliberately do NOT call `editor.setReadonly(true)` here.
    // Crepe's TopBar component bails out with `return null` when the view
    // is read-only, but the render function never accesses any reactive
    // ref in that branch — so when we flip back to editable Vue does not
    // re-render and the toolbar stays empty for the rest of the session.
    // Keeping Crepe editable + blocking interaction with CSS sidesteps
    // the framework bug entirely.
    this.host = document.createElement('div');
    this.host.className = 'ny-source-pane';
    this.editorRoot.classList.add('is-source-mode');
    this.editorRoot.parentElement?.classList.add('is-source-mode-host');
    this.editorRoot.insertBefore(this.host, this.editorRoot.firstChild);

    this.cmView = new EditorView({
      parent: this.host,
      scrollTo: EditorView.scrollIntoView(range.main.head, { y: 'center' }),
      state: EditorState.create({
        doc: initialDoc,
        selection: range,
        extensions: [
          basicSetup,
          // Same call as the code blocks make (see editor/config.ts): basicSetup
          // turns on autocompletion, and in Markdown prose a popup on every word
          // is pure interruption. Still available on demand.
          autocompletion({ activateOnTyping: false }),
          // Tab indents. Unbound, it moved focus to the preview behind the
          // pane, and what was typed next went there and was lost at the
          // next sync.
          keymap.of([indentWithTab]),
          sourceSuggest(),
          Prec.high(keymap.of([{ key: 'Enter', run: continueMarkup }])),
          // GitHub's Markdown, as the file is read and written: struck text,
          // tables and task boxes were plain text here, the tildes and boxes
          // drawn like the words. Its sub- and superscripts are no part of
          // it, and took the `^` of a formula for one.
          markdown({
            base: markdownLanguage,
            extensions: { remove: ['Superscript', 'Subscript', 'Emoji'] },
          }),
          sourceSearch(),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          this.cmThemeCompartment.of(this.themeExtension()),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || this.applyingEditorText) return;
            this.invalidateAnchors();
            this.scheduleSync();
            // Unsaved at once: a quit decided before the sync above reached
            // the editor exited without asking, and the keys were lost.
            if (!this.store.getState().isDirty) {
              this.store.update({ isDirty: true });
            }
          }),
        ],
      }),
    });

    this.invalidateAnchors();
    this.cmView.focus();
    this.bindScrollSync();
  }

  private bindScrollSync() {
    if (!this.cmView || !this.previewView || !this.editorRoot) return;

    const cmScroller = this.cmView.scrollDOM;
    const previewPane = this.editorRoot.querySelector(
      '.milkdown'
    ) as HTMLElement | null;
    if (!cmScroller || !previewPane) return;

    // The preview pane outlives source mode, so every listener is tied to
    // this session and dropped on exit.
    this.scrollSyncAbort = new AbortController();
    const { signal } = this.scrollSyncAbort;
    // The source pane opens with the focus, scrolled to the caret.
    this.activeScrollSource = cmScroller;

    const userScrollEvents: Array<keyof HTMLElementEventMap> = [
      'pointerdown',
      'mousedown',
      'wheel',
      'touchstart',
      'keydown',
      'focusin',
    ];

    for (const eventName of userScrollEvents) {
      cmScroller.addEventListener(
        eventName,
        () => this.markScrollSource(cmScroller),
        { passive: true, signal }
      );
      previewPane.addEventListener(
        eventName,
        () => this.markScrollSource(previewPane),
        { passive: true, signal }
      );
    }

    // A pane led by the other scrolls too; that scroll is not followed back.
    const sync = (source: HTMLElement, target: HTMLElement) => {
      if (this.activeScrollSource !== source) return;

      requestAnimationFrame(() => {
        this.ensureAnchors();
        if (!this.cmView || !this.previewView) return;
        const cmView = this.cmView;

        const fromAnchors =
          source === cmScroller
            ? this.sourceAnchors.map((anchor) => ({
                key: anchor.key,
                top: cmView.lineBlockAt(anchor.from).top,
              }))
            : this.previewAnchors.map((anchor) => ({
                key: anchor.key,
                top: paneContentTop(previewPane, anchor.dom),
              }));
        const toAnchors =
          source === cmScroller
            ? this.previewAnchors.map((anchor) => ({
                key: anchor.key,
                top: paneContentTop(previewPane, anchor.dom),
              }))
            : this.sourceAnchors.map((anchor) => ({
                key: anchor.key,
                top: cmView.lineBlockAt(anchor.from).top,
              }));

        target.scrollTop = syncedScrollTop(
          source,
          target,
          fromAnchors,
          toAnchors
        );
      });
    };

    cmScroller.addEventListener('scroll', () => sync(cmScroller, previewPane), {
      passive: true,
      signal,
    });
    previewPane.addEventListener(
      'scroll',
      () => sync(previewPane, cmScroller),
      { passive: true, signal }
    );
  }

  private exit() {
    if (!this.active) return;
    this.active = false;

    const cm = this.cmView;
    const caret = cm && {
      text: cm.state.doc.toString(),
      anchor: cm.state.selection.main.anchor,
      head: cm.state.selection.main.head,
    };
    this.flush();
    this.scrollSyncAbort?.abort();
    this.scrollSyncAbort = null;
    if (this.cmView) {
      this.cmView.destroy();
      this.cmView = null;
    }

    this.host?.remove();
    this.host = null;
    this.editorRoot.classList.remove('is-source-mode');
    this.editorRoot.parentElement?.classList.remove('is-source-mode-host');
    this.anchorsDirty = true;
    this.activeScrollSource = null;
    if (caret) this.placeCaret(caret);
  }

  /**
   * Puts the editor's caret and selection where the source pane's were, in
   * the middle of the page, and hands focus back as entering gave it away.
   */
  private placeCaret(caret: { text: string; anchor: number; head: number }) {
    const view = this.editor.getView();
    if (!view) return;
    const spans = this.editor.blockSpans(caret.text);
    const { doc } = view.state;
    const toDoc = (offset: number) =>
      doc.resolve(docPosition(doc, offset, caret.text, spans));
    const selection = TextSelection.between(
      toDoc(caret.anchor),
      toDoc(caret.head)
    );
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();

    const scroller = this.editorRoot.parentElement;
    if (!scroller) return;
    const { top, bottom } = view.coordsAtPos(selection.head);
    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += (top + bottom) / 2 - (box.top + box.height / 2);
  }

  private scheduleSync() {
    if (this.syncTimer != null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.flush(), SYNC_DELAY_MS);
  }
}
