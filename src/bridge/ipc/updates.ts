import {
  type DownloadEvent,
  type Update,
  check,
} from '@tauri-apps/plugin-updater';

export type { DownloadEvent, Update };

/** The newer release the updater feed offers, or null when up to date. */
export async function checkForUpdate(): Promise<Update | null> {
  return await check();
}
