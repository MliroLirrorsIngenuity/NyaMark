import { type ImageSettings, defaultImageSettings } from './image-settings';
import {
  hasPersistedLanguage as hasStoredLanguage,
  loadPersistedSettings,
  savePersistedSettings,
} from '../bridge/ipc/settings';
import { getPlatform } from '../platform/detect';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { setNativeWindowBackdrop } from '../bridge/ipc/windows';

export type AppearanceSettings = {
  fontSize: number;
  lineHeight: number;
  readableMaxWidth: number;
  windowTransparency: boolean;
};

export type SaveSettings = {
  autoSave: boolean;
  autoSaveIntervalMs: number;
};

export type GeneralSettings = {
  language: string;
};

export type Settings = {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  save: SaveSettings;
  attachments: ImageSettings;
};

const SETTINGS_EVENT = 'nyamark:settingschange';

export const defaultSettings: Settings = {
  general: {
    language: 'auto',
  },
  appearance: {
    fontSize: 14,
    lineHeight: 1.52,
    readableMaxWidth: 720,
    windowTransparency: false,
  },
  save: {
    autoSave: false,
    autoSaveIntervalMs: 60_000,
  },
  attachments: defaultImageSettings,
};

let cached: Settings = structuredClone(defaultSettings);
let hydrated = false;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function applyWindowEffects(transparency: boolean) {
  const platform = getPlatform();
  if (platform === 'linux') {
    document.documentElement.classList.remove('ny-shell--transparent');
    return;
  }

  try {
    const win = getCurrentWindow();
    if (transparency) {
      if (platform === 'macos') {
        await win.setEffects({
          effects: [Effect.Sidebar],
          state: EffectState.Active,
        });
      } else if (platform === 'windows') {
        await setNativeWindowBackdrop(true);
      }
      document.documentElement.classList.add('ny-shell--transparent');
    } else {
      if (platform === 'windows') {
        document.documentElement.classList.remove('ny-shell--transparent');
        await setNativeWindowBackdrop(false);
        return;
      }
      await win.clearEffects();
      document.documentElement.classList.remove('ny-shell--transparent');
    }
  } catch (e) {
    if (platform === 'windows') {
      document.documentElement.classList.remove('ny-shell--transparent');
    }
    console.error('Failed to apply window effects:', e);
  }
}

export function sanitizeAppearanceSettings(
  appearance: Partial<AppearanceSettings> | undefined
): AppearanceSettings {
  return {
    fontSize: clamp(
      Number(appearance?.fontSize ?? defaultSettings.appearance.fontSize),
      11,
      22
    ),
    lineHeight: clamp(
      Number(appearance?.lineHeight ?? defaultSettings.appearance.lineHeight),
      1.2,
      2.2
    ),
    readableMaxWidth: clamp(
      Number(
        appearance?.readableMaxWidth ??
          defaultSettings.appearance.readableMaxWidth
      ),
      520,
      1100
    ),
    windowTransparency: Boolean(
      appearance?.windowTransparency ??
        defaultSettings.appearance.windowTransparency
    ),
  };
}

function sanitizeGeneralSettings(
  general: Partial<GeneralSettings> | undefined
): GeneralSettings {
  const allowedLanguages = ['en', 'zh-CN', 'zh-TW'];
  const lang = general?.language;
  return {
    language:
      typeof lang === 'string' && allowedLanguages.includes(lang)
        ? lang
        : defaultSettings.general.language,
  };
}

function sanitizeSaveSettings(
  save: Partial<SaveSettings> | undefined
): SaveSettings {
  return {
    autoSave: Boolean(save?.autoSave),
    autoSaveIntervalMs: clamp(
      Number(
        save?.autoSaveIntervalMs ?? defaultSettings.save.autoSaveIntervalMs
      ),
      60_000,
      3_600_000
    ),
  };
}

function applyAppearance(appearance: AppearanceSettings) {
  const root = document.documentElement.style;
  root.setProperty('--ny-editor-font-size', `${appearance.fontSize}px`);
  root.setProperty('--ny-editor-line-height', String(appearance.lineHeight));
  root.setProperty(
    '--ny-editor-readable-max',
    `${appearance.readableMaxWidth}px`
  );
  void applyWindowEffects(appearance.windowTransparency);
}

export function previewAppearance(appearance: AppearanceSettings) {
  applyAppearance(sanitizeAppearanceSettings(appearance));
}

function normalizeSettings(
  parsed: Partial<Settings> | null | undefined
): Settings {
  return {
    general: sanitizeGeneralSettings(parsed?.general),
    appearance: sanitizeAppearanceSettings(parsed?.appearance),
    save: sanitizeSaveSettings(parsed?.save),
    attachments: {
      ...defaultSettings.attachments,
      ...(parsed?.attachments ?? {}),
    },
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

export async function hasPersistedLanguage() {
  return await hasStoredLanguage();
}

export async function saveSettings(next: Settings) {
  const previous = cached;
  cached = normalizeSettings(next);
  applyAppearance(cached.appearance);
  hydrated = true;
  try {
    await savePersistedSettings(cached);
  } catch (error) {
    cached = previous;
    applyAppearance(previous.appearance);
    throw error;
  }
  window.dispatchEvent(
    new CustomEvent<Settings>(SETTINGS_EVENT, { detail: cached })
  );
}

export async function updateSettings(partial: Partial<Settings>) {
  const current = getSettings();
  const merged: Settings = {
    general: { ...current.general, ...(partial.general ?? {}) },
    appearance: { ...current.appearance, ...(partial.appearance ?? {}) },
    save: { ...current.save, ...(partial.save ?? {}) },
    attachments: { ...current.attachments, ...(partial.attachments ?? {}) },
  };
  await saveSettings(merged);
}

export function subscribeSettings(
  listener: (settings: Settings) => void
): () => void {
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
