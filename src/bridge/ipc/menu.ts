import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type AppMenuAction =
  | 'new-file'
  | 'open-file'
  | 'save-file'
  | 'save-file-as'
  | 'export-pdf'
  | 'open-settings'
  | 'check-updates'
  | 'toggle-ai';

const APP_MENU_ACTION_EVENT = 'nyamark://menu-action';

const KNOWN_ACTIONS = new Set<AppMenuAction>([
  'new-file',
  'open-file',
  'save-file',
  'save-file-as',
  'export-pdf',
  'open-settings',
  'check-updates',
  'toggle-ai',
]);

export async function listenAppMenuAction(
  handler: (action: AppMenuAction) => void
): Promise<UnlistenFn> {
  return await getCurrentWindow().listen<AppMenuAction>(
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
  await invoke('update_macos_menu', { translations });
}
