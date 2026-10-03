import { getVersion } from '@tauri-apps/api/app';
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

/**
 * Whether the check reached the feed and found no release in it. The stable
 * feed lives on the newest stable release, and is missing until the first
 * one is out and while a new one is still uploading its files.
 */
export function isFeedMissing(error: unknown): boolean {
  return String(error).includes('valid release JSON');
}

/** The version of NyaMark that is running. */
export async function currentVersion(): Promise<string> {
  return await getVersion();
}
