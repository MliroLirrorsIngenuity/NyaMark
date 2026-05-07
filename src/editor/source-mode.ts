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

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

import type { NyaEditor } from './editor';
import type { Store } from '../state/store';
import { ensureStyle } from '../style/register';

const SYNC_DELAY_MS = 180;

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
  background: var(--ny-editor-codeblock-bg, transparent);
}

#editor-container.is-source-mode > .milkdown {
  grid-column: 2;
}

/*
 * Disable interaction in the rendered pane while in source mode so the
 * user can only edit through the CodeMirror side. We can't toggle
 * Crepe's setReadonly without losing the toolbar (see source-mode.ts).
 */
#editor-container.is-source-mode > .milkdown .ProseMirror {
  user-select: text;
  cursor: default;
  pointer-events: none;
}

#editor-container.is-source-mode > .milkdown .milkdown-top-bar,
#editor-container.is-source-mode > .milkdown .milkdown-toolbar {
  pointer-events: none;
  opacity: 0.55;
}

.ny-source-pane {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.ny-source-pane .cm-editor {
  flex: 1;
  height: 100%;
  background: transparent;
  font-family: var(--ny-font-mono);
  font-size: 13px;
  line-height: 1.45;
}

.ny-source-pane .cm-scroller {
  padding: 16px clamp(12px, 3vw, 28px);
}

.ny-source-pane .cm-content {
  caret-color: var(--ny-editor-text-primary);
}
`;

function registerSourceModeStyles() {
  ensureStyle('editor-source-mode', css);
}

export class SourceModeController {
  private host: HTMLElement | null = null;
  private cmView: EditorView | null = null;
  private cmThemeCompartment = new Compartment();
  private syncTimer: number | null = null;
  private active = false;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeTheme: (() => void) | null = null;

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
    window.addEventListener('nyamark:themechange', handleThemeChange as EventListener);
    this.unsubscribeTheme = () => {
      window.removeEventListener('nyamark:themechange', handleThemeChange as EventListener);
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

  private enter() {
    if (this.active) return;
    this.active = true;

    const initialDoc = this.editor.getMarkdown();

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
            this.scheduleSync();
          }),
        ],
      }),
    });

    this.cmView.focus();
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
      }
    }, SYNC_DELAY_MS);
  }
}
