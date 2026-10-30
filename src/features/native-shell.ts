import { DocumentsError } from '../bridge/ipc/documents';
import {
  type NativeMessage,
  onNativeMessage,
  postToNative,
} from '../bridge/native-shell';
import type { NyaEditor } from '../editor/editor';
import type { SourceModeController } from '../editor/source-mode';
import { i18next } from '../i18n';
import { store } from '../state/store';
import { setBottomCover } from '../ui/bottom-cover';
import { documentFileName } from '../ui/document-name';
import type { ThemeManager } from '../ui/theme';
import type { MobileDocuments } from './mobile-documents';
import { dispatchPanel } from './native/panels';

const DOCUMENT_FOCUS =
  '#ny-editor-container .ProseMirror, #ny-editor-container .cm-content';

export interface NativeShellHost {
  editor: () => NyaEditor | null;
  sourceMode: () => SourceModeController | null;
  documents: MobileDocuments;
  theme: ThemeManager;
  /** What the editor page's menu and buttons ask for, by name. */
  actions: Record<string, () => unknown>;
  reportFailure: (error: unknown) => void;
}

/** Tells the native screens which document the page holds, once it is ready. */
export function announceReady(path: string | null) {
  postToNative({ type: 'ready', path, language: i18next.language });
}

/** Lets the native editor page show the document's opening while the rest is drawn. */
export function showOpening() {
  postToNative({ type: 'shown' });
}

/**
 * Connects the page to the native library, editor page and keyboard bar
 * around it: their commands run here, and the title, the source mode and the
 * formatting at the caret go back to them.
 */
export function bindNativeShell(host: NativeShellHost) {
  onNativeMessage((message) => {
    receive(host, message).catch(host.reportFailure);
  });

  let lastState = '';
  let frame = 0;
  const postState = () => {
    frame = 0;
    const { filePath, sourceMode, isDirty, wordCount } = store.getState();
    const saved = i18next.t(
      isDirty || !filePath ? 'mobile.unsaved' : 'mobile.saved'
    );
    const words = i18next.t('statusbar.words', { count: wordCount });
    const state = {
      type: 'state',
      title: filePath ? documentFileName(filePath) : '',
      status: `${saved} · ${words}`,
      sourceMode,
      active: sourceMode ? [] : (host.editor()?.activeBarItems() ?? []),
    };
    const text = JSON.stringify(state);
    if (text === lastState) return;
    lastState = text;
    postToNative(state);
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(postState);
  };
  document.addEventListener('selectionchange', schedule);
  store.subscribe(schedule);
  host.editor()?.onDocChanged(schedule);
  schedule();

  host.theme.onChange(() => postTheme(host.theme.followsSystem()));
  i18next.on('languageChanged', schedule);

  let editing = false;
  const focusMoved = () => {
    const now = !!document.activeElement?.closest(DOCUMENT_FOCUS);
    if (now === editing) return;
    editing = now;
    postToNative({ type: 'focus', document: now });
  };
  document.addEventListener('focusin', focusMoved);
  document.addEventListener('focusout', () => queueMicrotask(focusMoved));
}

/** The page's colours the native bars draw with, by their custom property's name. */
const THEME_COLORS = [
  'app-bg-start',
  'app-bg-end',
  'statusbar-bg',
  'border-soft',
  'border-button',
  'fill-soft',
  'text-primary',
  'text-secondary',
  'text-muted',
  'accent',
  'accent-soft',
  'accent-ink',
  'dock-bg',
  'line',
  'accent-line',
  'warning',
  'del-ink',
  'ok',
  'border-strong',
  'on-accent',
  'ink',
  'on-ink',
];

/**
 * Sends the colours as the stylesheet resolves them, as RGBA bytes: a canvas
 * paints each, so `color-mix()` and every other notation arrive the same way.
 */
function postTheme(followsSystem: boolean) {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  const colors: Record<string, number[]> = {};
  for (const name of THEME_COLORS) {
    probe.style.color = `var(--ny-${name})`;
    if (!paint) break;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = getComputedStyle(probe).color;
    paint.fillRect(0, 0, 1, 1);
    colors[name] = Array.from(paint.getImageData(0, 0, 1, 1).data);
  }
  probe.remove();
  postToNative({
    type: 'theme',
    dark: document.documentElement.dataset.theme === 'dark',
    followsSystem,
    colors,
  });
}

async function receive(host: NativeShellHost, message: NativeMessage) {
  switch (message.type) {
    case 'command': {
      const name = String(message.name);
      if (store.getState().sourceMode) host.sourceMode()?.runKey(name);
      else host.editor()?.runBarItem(name);
      return;
    }
    case 'insert':
      host.sourceMode()?.type(String(message.text));
      return;
    case 'action':
      await host.actions[String(message.name)]?.();
      return;
    case 'open':
      try {
        const reloading = await host.documents.switchTo(String(message.path));
        if (!reloading) announceReady(store.getState().filePath);
      } catch (error) {
        announceReady(store.getState().filePath);
        throw error;
      }
      return;
    case 'rename': {
      const path = store.getState().filePath;
      let error: string | null = null;
      try {
        if (path) await host.documents.rename(path, String(message.stem));
      } catch (failure) {
        error = renameError(failure, String(message.stem));
      }
      postToNative({ type: 'reply', id: message.reply, error });
      return;
    }
    case 'insets': {
      const bottom = Number(message.bottom) || 0;
      const container = document.getElementById('ny-editor-container');
      keepEndInView(() => {
        if (!container) return;
        container.style.paddingBottom = `calc(${END_ROOM_PX}px + ${bottom}px)`;
      });
      setBottomCover(bottom);
      revealField(bottom);
      return;
    }
    case 'leave':
      await host.documents.leaveForLibrary();
      return;
    case 'panel':
      await dispatchPanel(message);
      return;
    case 'keyboard':
      leaveDocument();
      return;
  }
}

/** The room under the document's last line, as the stylesheet keeps it on a phone. */
const END_ROOM_PX = 48;

/** The panes the document scrolls in: the page, and the source pane's own. */
const SCROLLERS = '.ny-shell__body, .ny-source-pane .cm-scroller';

/** The room under the document follows the keyboard and the toolbar; a pane scrolled to its end stays at its end. */
function keepEndInView(change: () => void) {
  const atEnd = Array.from(
    document.querySelectorAll<HTMLElement>(SCROLLERS)
  ).filter(
    (pane) => pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
  );
  change();
  for (const pane of atEnd) pane.scrollTop = pane.scrollHeight;
}

/** A field of the page's own, as a link's address, comes out from under the keyboard, which WebKit leaves to the page. */
function revealField(bottom: number) {
  const page = document.querySelector<HTMLElement>('.ny-shell__body');
  if (!page) return;
  page.style.scrollPaddingBottom = `${bottom}px`;
  const field = document.activeElement;
  if (
    field instanceof HTMLElement &&
    field.matches('input, textarea') &&
    page.contains(field)
  ) {
    field.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * WebKit keeps the document focused when the keyboard goes down, and the
 * next tap then brings the keyboard back at the old caret, not where it fell.
 */
function leaveDocument() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.closest(DOCUMENT_FOCUS)) {
    focused.blur();
  }
}

function renameError(failure: unknown, stem: string) {
  if (failure instanceof DocumentsError && failure.code === 'exists') {
    return i18next.t('library.errors.exists', { name: stem });
  }
  if (failure instanceof DocumentsError && failure.code === 'invalid-name') {
    return i18next.t('library.errors.invalidName');
  }
  const reason = failure instanceof Error ? failure.message : String(failure);
  return i18next.t('library.errors.failed', { reason });
}
