import {
  type NativeMessage,
  onNativeMessage,
  postToNative,
} from '../bridge/native-shell';
import type { NyaEditor } from '../editor/editor';
import type { SourceModeController } from '../editor/source-mode';
import { i18next } from '../i18n';
import { store } from '../state/store';
import { documentFileName } from '../ui/document-name';
import type { MobileDocuments } from './mobile-documents';

const DOCUMENT_FOCUS =
  '#ny-editor-container .ProseMirror, #ny-editor-container .cm-content';

export interface NativeShellHost {
  editor: () => NyaEditor | null;
  sourceMode: () => SourceModeController | null;
  documents: MobileDocuments;
  /** What the editor page's menu and buttons ask for, by name. */
  actions: Record<string, () => unknown>;
  reportFailure: (error: unknown) => void;
}

/** Tells the native screens which document the page holds, once it is ready. */
export function announceReady(path: string | null) {
  postToNative({ type: 'ready', path, language: i18next.language });
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
    const { filePath, sourceMode } = store.getState();
    const state = {
      type: 'state',
      title: filePath ? documentFileName(filePath) : '',
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
      if (path) await host.documents.rename(path, String(message.stem));
      return;
    }
    case 'leave':
      await host.documents.leaveForLibrary();
      return;
  }
}
