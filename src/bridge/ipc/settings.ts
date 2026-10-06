import type { UnlistenFn } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  copyFile,
  exists,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import { type Store, load } from '@tauri-apps/plugin-store';
import type { Settings } from '../../state/settings';
import names from './settings-store.json';

/**
 * The plugin-store file, resolved under AppData, and the key the settings are
 * under: a window reads its look from them before its page loads. The
 * pre-store backend (every beta release) wrote raw settings to
 * AppConfig/settings.json, and on macOS and Windows AppData and AppConfig are
 * the same folder, so the store keeps a name of its own.
 */
const STORE_FILE = names.file;
const STORE_KEY = names.key;
const LEGACY_SETTINGS_FILE = 'settings.json';
const VERSION_KEY = 'version';
/** Bump together with a migration in `openStore` when the stored shape changes. */
const SCHEMA_VERSION = 1;

type OpenedStore = {
  store: Store;
  /** Absolute path the unreadable store file was copied to, if it was. */
  unreadableBackup: string | null;
};

let storePromise: Promise<OpenedStore> | null = null;

export type PersistedSettings = {
  settings: Partial<Settings>;
  unreadableBackup: string | null;
};

export async function loadPersistedSettings(): Promise<PersistedSettings> {
  const { store, unreadableBackup } = await settingsStore();
  const settings = (await store.get<Partial<Settings>>(STORE_KEY)) ?? {};
  return { settings, unreadableBackup };
}

export async function savePersistedSettings(settings: Settings): Promise<void> {
  const { store } = await settingsStore();
  const previous = await store.get<Settings>(STORE_KEY);

  await store.set(STORE_KEY, settings);
  await store.set(VERSION_KEY, SCHEMA_VERSION);
  try {
    await store.save();
  } catch (error) {
    if (previous === undefined) {
      await store.delete(STORE_KEY);
    } else {
      await store.set(STORE_KEY, previous);
    }
    throw error;
  }
}

/**
 * Fires for every write to the settings key, from any window: the store lives
 * on the Rust side and is shared by every window that loads the same file,
 * and its change event is broadcast app-wide.
 */
export async function onPersistedSettingsChange(
  handler: (settings: Partial<Settings> | undefined) => void
): Promise<UnlistenFn> {
  const { store } = await settingsStore();
  return await store.onKeyChange<Partial<Settings>>(STORE_KEY, handler);
}

function settingsStore(): Promise<OpenedStore> {
  storePromise ??= openStore().catch((error) => {
    storePromise = null;
    throw error;
  });
  return storePromise;
}

async function openStore(): Promise<OpenedStore> {
  const unreadableBackup = await backUpUnreadableStore();
  const store = await load(STORE_FILE, { defaults: {}, autoSave: false });
  await importLegacySettings(store);

  const version = await store.get<number>(VERSION_KEY);
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    console.warn(
      `Settings were written by a newer NyaMark (schema ${version}); unknown fields are ignored.`
    );
  }
  return { store, unreadableBackup };
}

/**
 * plugin-store discards a file it cannot parse and starts empty, and the next
 * save then replaces it. Copy such a file aside first so the user's settings
 * can still be recovered by hand.
 */
async function backUpUnreadableStore(): Promise<string | null> {
  const options = { baseDir: BaseDirectory.AppData };
  if (!(await exists(STORE_FILE, options))) return null;

  const raw = await readTextFile(STORE_FILE, options);
  if (!raw.trim() || isRecord(parseJson(raw))) return null;

  const backup = `preferences.unreadable-${Date.now()}.json`;
  await copyFile(STORE_FILE, backup, {
    fromPathBaseDir: BaseDirectory.AppData,
    toPathBaseDir: BaseDirectory.AppData,
  });
  return await join(await appDataDir(), backup);
}

async function importLegacySettings(store: Store) {
  if (await store.has(STORE_KEY)) return;

  const options = { baseDir: BaseDirectory.AppConfig };
  if (!(await exists(LEGACY_SETTINGS_FILE, options))) return;

  const parsed = parseJson(await readTextFile(LEGACY_SETTINGS_FILE, options));
  if (!isRecord(parsed)) {
    console.error('Ignoring unreadable legacy settings file');
    return;
  }
  // Development builds after the betas kept the store layout in this file.
  const legacy = isRecord(parsed[STORE_KEY]) ? parsed[STORE_KEY] : parsed;
  await store.set(STORE_KEY, legacy);
  await store.set(VERSION_KEY, SCHEMA_VERSION);
  await store.save();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
