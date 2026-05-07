import {
  type ImageSettings,
  defaultImageSettings,
} from './image-settings';
import {
  loadPersistedSettings,
  savePersistedSettings,
} from '../bridge/ipc/settings';

export type AppearanceSettings = {
  fontSize: number;
  lineHeight: number;
  readableMaxWidth: number;
};

export type SaveSettings = {
  autoSave: boolean;
  autoSaveIntervalMs: number;
};

export type Settings = {
  appearance: AppearanceSettings;
  save: SaveSettings;
  attachments: ImageSettings;
};

const SETTINGS_EVENT = 'nyamark:settingschange';

export const defaultSettings: Settings = {
  appearance: {
    fontSize: 14,
    lineHeight: 1.52,
    readableMaxWidth: 720,
  },
  save: {
    autoSave: false,
    autoSaveIntervalMs: 4000,
  },
  attachments: defaultImageSettings,
};

let cached: Settings = structuredClone(defaultSettings);
let hydrated = false;

function applyAppearance(appearance: AppearanceSettings) {
  const root = document.documentElement.style;
  root.setProperty('--ny-editor-font-size', `${appearance.fontSize}px`);
  root.setProperty('--ny-editor-line-height', String(appearance.lineHeight));
  root.setProperty('--ny-editor-readable-max', `${appearance.readableMaxWidth}px`);
}

function normalizeSettings(parsed: Partial<Settings> | null | undefined): Settings {
  return {
    appearance: { ...defaultSettings.appearance, ...(parsed?.appearance ?? {}) },
    save: { ...defaultSettings.save, ...(parsed?.save ?? {}) },
    attachments: { ...defaultSettings.attachments, ...(parsed?.attachments ?? {}) },
  };
}

export function getSettings(): Settings {
  applyAppearance(cached.appearance);
  return cached;
}

export async function hydrateSettings(): Promise<Settings> {
  if (hydrated) return getSettings();
  try {
    cached = normalizeSettings(await loadPersistedSettings());
  } catch (error) {
    console.error('Failed to load settings:', error);
    cached = structuredClone(defaultSettings);
  }

  hydrated = true;
  applyAppearance(cached.appearance);
  return cached;
}

export async function saveSettings(next: Settings) {
  const previous = cached;
  cached = next;
  applyAppearance(next.appearance);
  hydrated = true;
  try {
    await savePersistedSettings(next);
  } catch (error) {
    cached = previous;
    applyAppearance(previous.appearance);
    throw error;
  }
  window.dispatchEvent(new CustomEvent<Settings>(SETTINGS_EVENT, { detail: next }));
}

export async function updateSettings(partial: Partial<Settings>) {
  const current = getSettings();
  const merged: Settings = {
    appearance: { ...current.appearance, ...(partial.appearance ?? {}) },
    save: { ...current.save, ...(partial.save ?? {}) },
    attachments: { ...current.attachments, ...(partial.attachments ?? {}) },
  };
  await saveSettings(merged);
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Settings>).detail;
    listener(detail);
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  listener(getSettings());
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

export async function resetSettings() {
  await saveSettings(structuredClone(defaultSettings));
}
