import { invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  watchImmediate,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

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

export async function confirmDialog(
  message: string,
  options: { title: string; okLabel: string; cancelLabel: string }
): Promise<boolean> {
  return await ask(message, { kind: 'warning', ...options });
}

export async function errorDialog(msg: string): Promise<void> {
  await message(msg, { kind: 'error' });
}

export async function readMarkdown(path: string): Promise<string> {
  return await readTextFile(path);
}

export async function saveMarkdown(
  path: string,
  content: string
): Promise<string> {
  await writeTextFile(path, content);
  return content;
}

export async function watchMarkdownFile(
  path: string,
  handler: () => void
): Promise<() => void> {
  return await watchImmediate(path, () => handler());
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
