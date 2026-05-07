import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export async function openFileDialog(): Promise<string | null> {
  const result = await open({
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    multiple: false,
  });
  return result as string | null;
}

export async function saveFileDialog(): Promise<string | null> {
  const result = await save({
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  return result as string | null;
}

export async function openDirectoryDialog(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
  });
  return result as string | null;
}

export async function readMarkdown(path: string): Promise<string> {
  return await invoke('read_markdown', { path });
}

export async function saveMarkdown(path: string, content: string): Promise<string> {
  return await invoke('save_markdown', { path, content });
}

export async function resolveCurrentWindowFile(): Promise<string | null> {
  return await invoke<string | null>('resolve_current_window_file');
}

export async function openMarkdownInNewWindow(path: string): Promise<void> {
  await invoke('open_markdown_in_new_window', { path });
}

export async function openNewWindow(): Promise<void> {
  await invoke('open_new_window');
}
