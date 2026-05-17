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

import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { EditorView as ProseMirrorEditorView } from 'prosemirror-view';

import type { NyaEditor } from './editor';
import type { Store } from '../state/store';
import { ensureStyle } from '../style/register';

const SYNC_DELAY_MS = 180;
const SYNC_REFERENCE_RATIO = 0.28;

type SourceAnchor = {
  from: number;
  key: string;
};

type PreviewAnchor = {
  dom: HTMLElement;
  key: string;
};

type ScrollGuidePoint = {
  fromTop: number;
  toTop: number;
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

function registerSourceModeStyles() {
  ensureStyle('editor-source-mode', css);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isHeadingNodeName(name: string) {
  return /^ATXHeading[1-6]$/.test(name) || /^SetextHeading[12]$/.test(name);
}

function normalizeHeadingText(text: string) {
  const [firstLine] = text.trim().split(/\r?\n/);

  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function buildScrollGuidePoints(
  fromAnchors: Array<{ key: string; top: number }>,
  toAnchors: Array<{ key: string; top: number }>,
  fromMax: number,
  toMax: number
) {
  if (fromMax <= 0 || toMax <= 0) return [{ fromTop: 0, toTop: 0 }];

  const points: ScrollGuidePoint[] = [{ fromTop: 0, toTop: 0 }];
  let lastToIndex = -1;

  for (const fromAnchor of fromAnchors) {
    const fromTop = clamp(fromAnchor.top, 0, fromMax);
    if (fromTop <= points[points.length - 1].fromTop) continue;

    const toIndex = toAnchors.findIndex(
      (toAnchor, index) =>
        index > lastToIndex && toAnchor.key === fromAnchor.key
    );
    if (toIndex < 0) continue;

    lastToIndex = toIndex;

    points.push({
      fromTop,
      toTop: clamp(toAnchors[toIndex].top, 0, toMax),
    });
  }

  if (points.length === 1) {
    const count = Math.min(fromAnchors.length, toAnchors.length);
    for (let index = 0; index < count; index += 1) {
      const fromTop = clamp(fromAnchors[index].top, 0, fromMax);
      if (fromTop <= points[points.length - 1].fromTop) continue;

      points.push({
        fromTop,
        toTop: clamp(toAnchors[index].top, 0, toMax),
      });
    }
  }

  const lastPoint = points[points.length - 1];
  if (lastPoint.fromTop < fromMax || lastPoint.toTop < toMax) {
    points.push({ fromTop: fromMax, toTop: toMax });
  }

  return points;
}

function mapScrollTop(scrollTop: number, points: ScrollGuidePoint[]) {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].toTop;

  const lastPoint = points[points.length - 1];
  const x = clamp(scrollTop, 0, lastPoint.fromTop);

  let current = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    if (x <= next.fromTop) {
      const span = next.fromTop - current.fromTop;
      const ratio = span <= 0 ? 0 : (x - current.fromTop) / span;
      return current.toTop + ratio * (next.toTop - current.toTop);
    }

    current = next;
  }

  return lastPoint.toTop;
}

function mapViewportScrollTop(
  source: HTMLElement,
  target: HTMLElement,
  points: ScrollGuidePoint[]
) {
  const sourceReferenceTop =
    source.scrollTop + source.clientHeight * SYNC_REFERENCE_RATIO;
  const targetReferenceTop = mapScrollTop(sourceReferenceTop, points);
  const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);

  return clamp(
    targetReferenceTop - target.clientHeight * SYNC_REFERENCE_RATIO,
    0,
    targetMax
  );
}

export class SourceModeController {
  private host: HTMLElement | null = null;
  private cmView: EditorView | null = null;
  private previewView: ProseMirrorEditorView | null = null;
  private cmThemeCompartment = new Compartment();
  private syncTimer: number | null = null;
  private active = false;
  private lastScrollSource: HTMLElement | null = null;
  private activeScrollSource: HTMLElement | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeTheme: (() => void) | null = null;
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
    this.unsubscribeStore = this.store.subscribe((state) => {
      if (state.sourceMode === last) return;
      last = state.sourceMode;
      if (state.sourceMode) this.enter();
      else this.exit();
    });

    const handleThemeChange = () => {
      if (!this.cmView) return;
      this.cmView.dispatch({
        effects: this.cmThemeCompartment.reconfigure(this.themeExtension()),
      });
    };
    window.addEventListener(
      'nyamark:themechange',
      handleThemeChange as EventListener
    );
    this.unsubscribeTheme = () => {
      window.removeEventListener(
        'nyamark:themechange',
        handleThemeChange as EventListener
      );
    };
  }

  destroy() {
    if (this.active) this.exit();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
  }

  private themeExtension() {
    return document.documentElement.dataset.theme === 'dark' ? [oneDark] : [];
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
          markdown(),
          this.cmThemeCompartment.of(this.themeExtension()),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
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
        {
          passive: true,
        }
      );
      previewPane.addEventListener(
        eventName,
        () => this.markScrollSource(previewPane),
        {
          passive: true,
        }
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

        const fromAnchors =
          source === cmScroller
            ? this.sourceAnchors.map((anchor) => ({
                key: anchor.key,
                top: this.cmView!.lineBlockAt(anchor.from).top,
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
                top: this.cmView!.lineBlockAt(anchor.from).top,
              }));

        const guide = buildScrollGuidePoints(
          fromAnchors,
          toAnchors,
          Math.max(0, source.scrollHeight - source.clientHeight),
          Math.max(0, target.scrollHeight - target.clientHeight)
        );

        if (guide.length === 0) {
          this.lastScrollSource = null;
          return;
        }

        target.scrollTop = mapViewportScrollTop(source, target, guide);

        requestAnimationFrame(() => {
          this.lastScrollSource = null;
        });
      });
    };

    cmScroller.addEventListener('scroll', () => sync(cmScroller, previewPane), {
      passive: true,
    });
    previewPane.addEventListener(
      'scroll',
      () => sync(previewPane, cmScroller),
      { passive: true }
    );
  }

  private exit() {
    if (!this.active) return;
    this.active = false;

    if (this.syncTimer != null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.cmView) {
      const text = this.cmView.state.doc.toString();
      this.editor.setMarkdown(text);
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
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      if (!this.cmView) return;
      const text = this.cmView.state.doc.toString();
      if (text !== this.editor.getMarkdown()) {
        this.editor.setMarkdown(text);
        this.invalidateAnchors();
      }
    }, SYNC_DELAY_MS);
  }
}
