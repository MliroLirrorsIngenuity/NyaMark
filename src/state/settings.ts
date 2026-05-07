import {
  type ImageSettings,
  defaultImageSettings,
} from './image-settings';

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

const STORAGE_KEY = 'nyamark-settings';
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

let cached: Settings | null = null;

function applyAppearance(appearance: AppearanceSettings) {
  const root = document.documentElement.style;
  root.setProperty('--ny-editor-font-size', `${appearance.fontSize}px`);
  root.setProperty('--ny-editor-line-height', String(appearance.lineHeight));
  root.setProperty('--ny-editor-readable-max', `${appearance.readableMaxWidth}px`);
}

export function loadSettings(): Settings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      cached = {
        appearance: { ...defaultSettings.appearance, ...(parsed.appearance ?? {}) },
        save: { ...defaultSettings.save, ...(parsed.save ?? {}) },
        attachments: { ...defaultSettings.attachments, ...(parsed.attachments ?? {}) },
      };
      applyAppearance(cached.appearance);
      return cached;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }

  // Backwards compat: if a legacy image-settings entry exists, fold it in.
  try {
    const legacy = localStorage.getItem('nyamark-image-settings');
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<ImageSettings>;
      cached = {
        ...defaultSettings,
        attachments: { ...defaultSettings.attachments, ...parsed },
      };
      saveSettings(cached);
      applyAppearance(cached.appearance);
      return cached;
    }
  } catch (error) {
    console.error('Failed to migrate legacy image-settings:', error);
  }

  cached = defaultSettings;
  applyAppearance(cached.appearance);
  return cached;
}

export function saveSettings(next: Settings) {
  cached = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyAppearance(next.appearance);
  window.dispatchEvent(new CustomEvent<Settings>(SETTINGS_EVENT, { detail: next }));
}

export function updateSettings(partial: Partial<Settings>) {
  const current = loadSettings();
  const merged: Settings = {
    appearance: { ...current.appearance, ...(partial.appearance ?? {}) },
    save: { ...current.save, ...(partial.save ?? {}) },
    attachments: { ...current.attachments, ...(partial.attachments ?? {}) },
  };
  saveSettings(merged);
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Settings>).detail;
    listener(detail);
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  listener(loadSettings());
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

export function resetSettings() {
  saveSettings(defaultSettings);
}
