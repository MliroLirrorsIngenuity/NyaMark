import {
  type ImageInsertPolicy,
  type ImageSettings,
  defaultImageSettings,
} from './image-settings';
import {
  loadPersistedSettings,
  onPersistedSettingsChange,
  savePersistedSettings,
} from '../bridge/ipc/settings';
import { getPlatform } from '../platform/detect';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { setNativeWindowBackdrop } from '../bridge/ipc/windows';

/** `auto` follows the operating system. */
export type ThemePreference = 'auto' | 'light' | 'dark';

export type AppearanceSettings = {
  theme: ThemePreference;
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
    theme: 'auto',
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
let unreadableSettingsBackup: string | null = null;
let themeApplier: ((theme: ThemePreference) => void) | null = null;

/**
 * The theme controller registers here so the theme is applied together with
 * the rest of the appearance: on load, on save, on a live preview from the
 * settings dialog, and when another window changes it.
 */
export function registerThemeApplier(
  applier: ((theme: ThemePreference) => void) | null
) {
  themeApplier = applier;
  applier?.(cached.appearance.theme);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** `clamp` for a stored value that may be missing or not a number at all. */
function clampSetting(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const number = Number(value ?? fallback);
  return clamp(Number.isFinite(number) ? number : fallback, min, max);
}

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
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
  const theme = appearance?.theme;
  return {
    theme:
      theme === 'light' || theme === 'dark'
        ? theme
        : defaultSettings.appearance.theme,
    fontSize: clampSetting(
      appearance?.fontSize,
      defaultSettings.appearance.fontSize,
      11,
      22
    ),
    lineHeight: clampSetting(
      appearance?.lineHeight,
      defaultSettings.appearance.lineHeight,
      1.2,
      2.2
    ),
    readableMaxWidth: clampSetting(
      appearance?.readableMaxWidth,
      defaultSettings.appearance.readableMaxWidth,
      520,
      1100
    ),
    windowTransparency: booleanSetting(
      appearance?.windowTransparency,
      defaultSettings.appearance.windowTransparency
    ),
  };
}

function sanitizeGeneralSettings(
  general: Partial<GeneralSettings> | undefined
): GeneralSettings {
  const allowedLanguages = ['auto', 'en', 'zh-CN', 'zh-TW'];
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
    autoSave: booleanSetting(save?.autoSave, defaultSettings.save.autoSave),
    autoSaveIntervalMs: clampSetting(
      save?.autoSaveIntervalMs,
      defaultSettings.save.autoSaveIntervalMs,
      60_000,
      3_600_000
    ),
  };
}

const INSERT_POLICIES: readonly ImageInsertPolicy[] = [
  'use-path',
  'copy-same-folder',
  'copy-assets',
  'copy-custom-folder',
  'base64',
];

function isInsertPolicy(value: unknown): value is ImageInsertPolicy {
  return INSERT_POLICIES.includes(value as ImageInsertPolicy);
}

function sanitizeAttachmentSettings(
  attachments: Partial<ImageSettings> | undefined
): ImageSettings {
  const defaults = defaultSettings.attachments;
  const pasted: unknown = attachments?.pastedImagePolicy;
  const directory = attachments?.customCopyDirectory;
  return {
    insertPolicy: isInsertPolicy(attachments?.insertPolicy)
      ? attachments.insertPolicy
      : defaults.insertPolicy,
    // A pasted image has no source file, so it can never keep its own path.
    pastedImagePolicy:
      isInsertPolicy(pasted) && pasted !== 'use-path' ? pasted : null,
    preferRelativePath: booleanSetting(
      attachments?.preferRelativePath,
      defaults.preferRelativePath
    ),
    ensureDotSlash: booleanSetting(
      attachments?.ensureDotSlash,
      defaults.ensureDotSlash
    ),
    escapePath: booleanSetting(attachments?.escapePath, defaults.escapePath),
    customCopyDirectory:
      typeof directory === 'string' && directory.trim() ? directory : null,
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
  themeApplier?.(appearance.theme);
}

export function previewAppearance(appearance: AppearanceSettings) {
  applyAppearance(sanitizeAppearanceSettings(appearance));
}

export function normalizeSettings(
  parsed: Partial<Settings> | null | undefined
): Settings {
  return {
    general: sanitizeGeneralSettings(parsed?.general),
    appearance: sanitizeAppearanceSettings(parsed?.appearance),
    save: sanitizeSaveSettings(parsed?.save),
    attachments: sanitizeAttachmentSettings(parsed?.attachments),
  };
}

export function getSettings(): Settings {
  return cached;
}

export async function hydrateSettings(): Promise<Settings> {
  if (hydrated) return cached;
  try {
    const persisted = await loadPersistedSettings();
    cached = normalizeSettings(persisted.settings);
    unreadableSettingsBackup = persisted.unreadableBackup;
  } catch (error) {
    console.error('Failed to load settings:', error);
    cached = structuredClone(defaultSettings);
  }

  hydrated = true;
  applyAppearance(cached.appearance);
  void followOtherWindows();
  return cached;
}

/**
 * Every window keeps its own copy of the settings; a write from any window
 * replaces the copies everywhere so no window later saves a stale snapshot
 * over the change. The writing window receives its own event too and
 * ignores it because the copy already matches.
 */
async function followOtherWindows() {
  try {
    await onPersistedSettingsChange((persisted) => {
      const next = normalizeSettings(persisted);
      if (JSON.stringify(next) === JSON.stringify(cached)) return;
      cached = next;
      applyAppearance(cached.appearance);
      window.dispatchEvent(
        new CustomEvent<Settings>(SETTINGS_EVENT, { detail: cached })
      );
    });
  } catch (error) {
    console.error('Failed to subscribe to settings changes:', error);
  }
}

/**
 * Where an unreadable settings file was copied before the defaults took over,
 * so the user can be told once. Cleared by the call.
 */
export function takeUnreadableSettingsBackup(): string | null {
  const backup = unreadableSettingsBackup;
  unreadableSettingsBackup = null;
  return backup;
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

export type SettingsPatch = {
  [Section in keyof Settings]?: Partial<Settings[Section]>;
};

export async function updateSettings(partial: SettingsPatch) {
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
