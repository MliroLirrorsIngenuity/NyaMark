import { type UnlistenFn } from '@tauri-apps/api/event';
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

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}
