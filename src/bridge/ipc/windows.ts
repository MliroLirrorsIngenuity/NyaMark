import { type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type Event } from '@tauri-apps/api/event';

export type WindowTheme = 'light' | 'dark';

export async function setWindowTitle(title: string): Promise<void> {
  await getCurrentWindow().setTitle(title);
}

export async function getWindowTheme(): Promise<WindowTheme | null> {
  const theme = await getCurrentWindow().theme();
  return theme === 'light' || theme === 'dark' ? theme : null;
}

export async function setWindowTheme(theme: WindowTheme | null): Promise<void> {
  await getCurrentWindow().setTheme(theme);
}

export async function listenWindowThemeChange(
  handler: (theme: WindowTheme) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().onThemeChanged(({ payload }) => {
    if (payload === 'light' || payload === 'dark') {
      handler(payload);
    }
  });
}

export async function listenWindowFileDrop(
  handler: (event: Event<DragDropEvent>) => void
): Promise<UnlistenFn> {
  return await getCurrentWindow().onDragDropEvent(handler);
}

export async function setNativeWindowBackdrop(enabled: boolean): Promise<void> {
  await invoke('set_windows_backdrop', { enabled });
}

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function unmaximizeWindow(): Promise<void> {
  await getCurrentWindow().unmaximize();
}

export async function isWindowMaximized(): Promise<boolean> {
  return await getCurrentWindow().isMaximized();
}

export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

/**
 * Registers the single decision point for closing this window. Returning
 * `false` from the handler keeps the window open; `true` destroys it. While a
 * handler is registered Tauri never destroys the window on its own.
 */
export async function onWindowCloseRequested(
  handler: () => Promise<boolean>
): Promise<UnlistenFn> {
  return await getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) {
      event.preventDefault();
    }
  });
}

export async function setWindowDirty(dirty: boolean): Promise<void> {
  await invoke('set_window_dirty', { dirty });
}

/** Restart after an update; dirty windows prompt first (see `quit.rs`). */
export async function requestAppRestart(): Promise<void> {
  await invoke('request_app_restart');
}

export async function cancelPendingQuit(): Promise<void> {
  await invoke('cancel_pending_quit');
}

export async function printCurrentWindow(): Promise<void> {
  await invoke('print_current_window');
}
