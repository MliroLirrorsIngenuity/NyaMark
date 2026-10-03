import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { Event } from '@tauri-apps/api/event';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';

export type WindowTheme = 'light' | 'dark';

export type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

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
  return await getCurrentWindow().onThemeChanged(({ payload }) => {
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

/** Windows: the DWM backdrop behind the transparent webview. */
export async function setNativeWindowBackdrop(enabled: boolean): Promise<void> {
  await invoke('set_windows_backdrop', { enabled });
}

/** macOS: the blur of what lies behind the transparent webview. */
export async function setWindowBlur(enabled: boolean): Promise<void> {
  await invoke('set_window_blur', { enabled });
}

/** Resize from an edge of an undecorated window, following the pointer. */
export async function startWindowResize(
  direction: ResizeDirection
): Promise<void> {
  await getCurrentWindow().startResizeDragging(direction);
}

/** Move an undecorated window with the pointer, while its button is held. */
export async function startWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
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

/** Called each time the window's size changes, maximized and restored too. */
export async function listenWindowResize(
  handler: () => void
): Promise<UnlistenFn> {
  return await getCurrentWindow().onResized(() => handler());
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

/** Whether any window holds unsaved changes. */
export async function anyWindowDirty(): Promise<boolean> {
  return await invoke('any_window_dirty');
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

/**
 * Whether this is the lowest-numbered window still open. App-wide chores
 * such as the update check run from that one window alone, so restoring
 * several windows at launch does not show several dialogs.
 */
export async function isPrimaryWindow(): Promise<boolean> {
  const rank = (label: string) => Number(label.replace(/^editor-/, '')) || 0;
  const current = rank(getCurrentWindow().label);
  const windows = await getAllWindows();
  return windows.every((window) => rank(window.label) >= current);
}
