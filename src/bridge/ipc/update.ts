import { invoke } from '@tauri-apps/api/core';

export async function startUpdate(assetUrl: string, assetName: string) {
  await invoke('start_update', {
    assetUrl,
    assetName,
  });
}
