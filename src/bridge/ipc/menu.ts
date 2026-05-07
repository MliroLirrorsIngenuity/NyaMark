import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
  return listen<AppMenuAction>(APP_MENU_ACTION_EVENT, (event) => {
    if (KNOWN_ACTIONS.has(event.payload)) {
      handler(event.payload);
    }
  });
}
