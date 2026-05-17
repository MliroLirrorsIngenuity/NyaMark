import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Settings } from '../../state/settings';

const LEGACY_SETTINGS_FILE = 'settings.json';
const STORE_KEY = 'settings';

let storePromise: Promise<Store> | null = null;

export async function loadPersistedSettings(): Promise<Settings> {
  const store = await settingsStore();
  await importLegacySettings(store);
  return ((await store.get<Settings>(STORE_KEY)) ?? {}) as Settings;
}

export async function savePersistedSettings(settings: Settings): Promise<void> {
  const store = await settingsStore();
  const previous = await store.get<Settings>(STORE_KEY);

  await store.set(STORE_KEY, settings);
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

export async function hasPersistedLanguage(): Promise<boolean> {
  try {
    const store = await settingsStore();
    await importLegacySettings(store);
    const settings = await store.get<Partial<Settings>>(STORE_KEY);
    return typeof settings?.general?.language === 'string';
  } catch (error) {
    console.error('Failed to inspect persisted language:', error);
    return false;
  }
}

async function settingsStore() {
  storePromise ??= load(LEGACY_SETTINGS_FILE, {
    defaults: {},
    autoSave: false,
  });
  return await storePromise;
}

async function importLegacySettings(store: Store) {
  if (await store.has(STORE_KEY)) {
    return;
  }

  if (!(await exists(LEGACY_SETTINGS_FILE, { baseDir: BaseDirectory.AppConfig }))) {
    return;
  }

  const raw = await readTextFile(LEGACY_SETTINGS_FILE, {
    baseDir: BaseDirectory.AppConfig,
  });
  const parsed = JSON.parse(raw) as Settings;
  await store.set(STORE_KEY, parsed);
  await store.save();
}
