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
 *  - we toggle `.is-source-mode` on `#editor-container` AND on its parent
 *    scroll body so the `:has()` rule isn't required for older WebViews,
 *  - the editor container becomes a 50/50 grid that stretches to the body's
 *    height; each pane owns its own scroll so the code pane stays anchored
 *    at the top regardless of how long the rendered preview gets.
 */

import { autocompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { tags } from '@lezer/highlight';
import { EditorView, basicSetup } from 'codemirror';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import type { Store } from '../state/store';
import { ensureStyle } from '../style/register';
import type { NyaEditor } from './editor';
import { normalizeHeadingText, syncedScrollTop } from './scroll-sync';

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

#editor-container.is-source-mode {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  min-height: 0;
}

#editor-container.is-source-mode > .ny-source-pane,
#editor-container.is-source-mode > .milkdown {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

#editor-container.is-source-mode > .ny-source-pane {
  grid-column: 1;
  border-right: 1px solid var(--ny-editor-panel-border, rgba(186, 196, 210, 0.6));
  background: var(--ny-bg-secondary);
}

#editor-container.is-source-mode > .milkdown {
  grid-column: 2;
}

#editor-container.is-source-mode > .milkdown > *:not(.ProseMirror) {
  display: none !important;
}

#editor-container.is-source-mode > .milkdown .ProseMirror {
  user-select: text;
  cursor: default;
  pointer-events: none;
  padding-top: 16px !important;
  padding-bottom: 16px !important;
}

.ny-source-pane {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.ny-source-pane .cm-editor,
.ny-source-pane .cm-gutters,
.ny-source-pane .cm-scroller {
  background-color: var(--ny-bg-secondary) !important;
}

.ny-source-pane .cm-editor {
  flex: 1;
  height: 100%;
  font-family: var(--ny-font-mono);
  font-size: 13px;
  line-height: 1.45;
  outline: none;
}

.ny-source-pane .cm-scroller {
  padding: 0;
}

.ny-source-pane .cm-content {
  padding: 16px 12px;
}

.ny-source-pane .cm-gutters {
  border-right: 1px solid var(--ny-editor-panel-border, rgba(186, 196, 210, 0.6)) !important;
  min-width: 45px;
  color: var(--ny-text-secondary);
  opacity: 0.8;
}

.ny-source-pane .cm-gutter {
  background-color: transparent !important;
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

function isHeadingNodeName(name: string) {
  return /^ATXHeading[1-6]$/.test(name) || /^SetextHeading[12]$/.test(name);
}

function buildSourceAnchors(state: EditorState): SourceAnchor[] {
  const anchors: SourceAnchor[] = [];
  const cursor = syntaxTree(state).cursor();

  if (!cursor.firstChild()) return anchors;

  do {
    if (isHeadingNodeName(cursor.name)) {
      anchors.push({
        from: cursor.from,
        key: normalizeHeadingText(
          state.doc.sliceString(cursor.from, cursor.to)
        ),
      });
    }
  } while (cursor.nextSibling());

  return anchors;
}

function buildPreviewAnchors(view: ProseMirrorEditorView): PreviewAnchor[] {
  return Array.from(view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
    (dom) => ({
      dom: dom as HTMLElement,
      key: normalizeHeadingText(dom.textContent ?? ''),
    })
  );
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
  private lastScrollSource: HTMLElement | null = null;
  private activeScrollSource: HTMLElement | null = null;
  /** Aborts the scroll-sync listeners of the current source-mode session. */
  private scrollSyncAbort: AbortController | null = null;
  private anchorsDirty = true;
  private sourceAnchors: SourceAnchor[] = [];
  private previewAnchors: PreviewAnchor[] = [];

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
    this.editor.setMarkdown(text);
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
    const { doc } = this.cmView.state;
    if (doc.toString() === text) return;
    this.applyingEditorText = true;
    try {
      this.cmView.dispatch({
        changes: { from: 0, to: doc.length, insert: text },
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

    this.sourceAnchors = buildSourceAnchors(this.cmView.state);
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
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          // Same call as the code blocks make (see editor/config.ts): basicSetup
          // turns on autocompletion, and in Markdown prose a popup on every word
          // is pure interruption. Still available on demand.
          autocompletion({ activateOnTyping: false }),
          markdown(),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          this.cmThemeCompartment.of(this.themeExtension()),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || this.applyingEditorText) return;
            this.invalidateAnchors();
            this.scheduleSync();
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

    const sync = (source: HTMLElement, target: HTMLElement) => {
      if (this.activeScrollSource && this.activeScrollSource !== source) {
        return;
      }

      if (this.lastScrollSource && this.lastScrollSource !== source) {
        return;
      }

      this.lastScrollSource = source;

      requestAnimationFrame(() => {
        this.ensureAnchors();
        if (!this.cmView || !this.previewView) {
          this.lastScrollSource = null;
          return;
        }
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

        requestAnimationFrame(() => {
          this.lastScrollSource = null;
        });
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
    // Don't focusAtEnd — that would yank the caret away from where the user
    // was editing in source view and force the WYSIWYG to scroll all the way
    // to the bottom (which also leaves the sticky toolbar in a weird state).
  }

  private scheduleSync() {
    if (this.syncTimer != null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.flush(), SYNC_DELAY_MS);
  }
}
