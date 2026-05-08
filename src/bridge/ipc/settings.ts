import { invoke } from '@tauri-apps/api/core';
import type { Settings } from '../../state/settings';

export async function loadPersistedSettings(): Promise<Settings> {
  return await invoke<Settings>('load_settings');
}

export async function savePersistedSettings(settings: Settings): Promise<void> {
  await invoke('save_settings', { settings });
}
