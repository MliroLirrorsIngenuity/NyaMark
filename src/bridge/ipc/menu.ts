import { type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

export type AppMenuAction =
  | 'new-file'
  | 'open-file'
  | 'save-file'
  | 'save-file-as'
  | 'open-settings';

const APP_MENU_ACTION_EVENT = 'nyamark://menu-action';

const KNOWN_ACTIONS = new Set<AppMenuAction>([
  'new-file',
  'open-file',
  'save-file',
  'save-file-as',
  'open-settings',
]);

export async function listenAppMenuAction(
  handler: (action: AppMenuAction) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<AppMenuAction>(
    APP_MENU_ACTION_EVENT,
    (event) => {
      if (KNOWN_ACTIONS.has(event.payload)) {
        handler(event.payload);
      }
    }
  );
}

export async function updateMacosMenu(
  translations: Record<string, string>
): Promise<void> {
  try {
    await invoke('update_macos_menu', { translations });
  } catch (error) {
    console.warn('Failed to update macOS menu:', error);
  }
}
