import { type ImageSettings, defaultImageSettings } from './image-settings';
import {
  loadPersistedSettings,
  savePersistedSettings,
} from '../bridge/ipc/settings';
import { getPlatform } from '../platform/detect';

export type AppearanceSettings = {
  fontSize: number;
  lineHeight: number;
  readableMaxWidth: number;
  windowOpacity: number;
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
    windowOpacity: 92,
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

function rgba([r, g, b]: [number, number, number], alpha: number) {
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function clearWindowOpacityOverrides(root: CSSStyleDeclaration) {
  root.removeProperty('--ny-app-bg-start');
  root.removeProperty('--ny-app-bg-end');
  root.removeProperty('--ny-surface-elevated');
  root.removeProperty('--ny-surface-muted');
  root.removeProperty('--ny-surface-ghost');
  root.removeProperty('--ny-titlebar-bg');
  root.removeProperty('--ny-statusbar-bg');
  root.removeProperty('--ny-linux-frost-sheen');
  root.removeProperty('--ny-linux-frost-glow');
  root.removeProperty('--ny-linux-frost-depth');
  root.removeProperty('--ny-window-toolbar-bg');
  root.removeProperty('--ny-window-floating-bg');
}

function applyWindowOpacity(windowOpacity: number) {
  const root = document.documentElement.style;
  const platform = getPlatform();
  if (platform !== 'windows' && platform !== 'linux') {
    clearWindowOpacityOverrides(root);
    return;
  }

  const opacity = clamp(windowOpacity, 72, 98) / 100;
  const isDark = document.documentElement.dataset.theme === 'dark';

  const palette = isDark
    ? {
        appStart: [16, 21, 27] as [number, number, number],
        appEnd: [19, 26, 34] as [number, number, number],
        elevated: [24, 31, 41] as [number, number, number],
        muted: [21, 28, 36] as [number, number, number],
        ghost: [20, 27, 35] as [number, number, number],
        titlebar: [19, 25, 33] as [number, number, number],
        statusbar: [17, 23, 31] as [number, number, number],
        linuxSheen: [141, 180, 200] as [number, number, number],
        linuxGlow: [96, 135, 158] as [number, number, number],
        linuxDepth: [0, 0, 0] as [number, number, number],
      }
    : {
        appStart: [255, 254, 251] as [number, number, number],
        appEnd: [255, 255, 255] as [number, number, number],
        elevated: [255, 255, 255] as [number, number, number],
        muted: [255, 255, 255] as [number, number, number],
        ghost: [250, 250, 249] as [number, number, number],
        titlebar: [255, 255, 255] as [number, number, number],
        statusbar: [255, 255, 255] as [number, number, number],
        linuxSheen: [255, 255, 255] as [number, number, number],
        linuxGlow: [141, 180, 200] as [number, number, number],
        linuxDepth: [77, 122, 143] as [number, number, number],
      };

  // Frosted-glass layering:
  // - The shell has `backdrop-filter: blur(40px)` via CSS, so whatever is
  //   behind the window is heavily blurred — not see-through stark.
  // - These alpha values sit on top of that blur, giving a translucent
  //   frosted look that stays readable even at lower opacity settings.
  //   At 98% → shell bg ~0.97 alpha, comfortable and near-opaque.
  //   At 72% → shell bg ~0.75, visible but faint blur-through hint.
  const appStartAlpha = clamp(opacity * 0.82 + 0.16, 0.75, 0.97);
  const appEndAlpha = clamp(opacity * 0.82 + 0.20, 0.79, 0.99);
  const surfaceElevatedAlpha = clamp(opacity * 0.70 + 0.28, 0.78, 0.99);
  const surfaceMutedAlpha = clamp(opacity * 0.78 + 0.12, 0.68, 0.92);
  const surfaceGhostAlpha = clamp(opacity * 0.78 + 0.20, 0.76, 0.96);
  const titlebarAlpha = clamp(opacity * 0.78 + 0.16, 0.72, 0.96);
  const statusbarAlpha = clamp(opacity * 0.78 + 0.22, 0.78, 0.98);
  const toolbarAlpha = clamp(opacity * 0.70 + 0.22, 0.72, 0.94);
  const floatingAlpha = clamp(opacity * 0.76 + 0.22, 0.77, 0.98);

  root.setProperty('--ny-app-bg-start', rgba(palette.appStart, appStartAlpha));
  root.setProperty('--ny-app-bg-end', rgba(palette.appEnd, appEndAlpha));
  root.setProperty(
    '--ny-surface-elevated',
    rgba(palette.elevated, surfaceElevatedAlpha)
  );
  root.setProperty('--ny-surface-muted', rgba(palette.muted, surfaceMutedAlpha));
  root.setProperty('--ny-surface-ghost', rgba(palette.ghost, surfaceGhostAlpha));
  root.setProperty('--ny-titlebar-bg', rgba(palette.titlebar, titlebarAlpha));
  root.setProperty('--ny-statusbar-bg', rgba(palette.statusbar, statusbarAlpha));
  root.setProperty(
    '--ny-window-toolbar-bg',
    rgba(palette.elevated, toolbarAlpha)
  );
  root.setProperty(
    '--ny-window-floating-bg',
    rgba(palette.elevated, floatingAlpha)
  );

  if (platform === 'linux') {
    root.setProperty(
      '--ny-linux-frost-sheen',
      rgba(palette.linuxSheen, isDark ? opacity * 0.14 : opacity * 0.52)
    );
    root.setProperty(
      '--ny-linux-frost-glow',
      rgba(palette.linuxGlow, isDark ? opacity * 0.2 : opacity * 0.24)
    );
    root.setProperty(
      '--ny-linux-frost-depth',
      rgba(palette.linuxDepth, isDark ? opacity * 0.24 : opacity * 0.14)
    );
  } else {
    root.removeProperty('--ny-linux-frost-sheen');
    root.removeProperty('--ny-linux-frost-glow');
    root.removeProperty('--ny-linux-frost-depth');
  }
}

export function supportsAdjustableWindowOpacity() {
  const platform = getPlatform();
  return platform === 'windows' || platform === 'linux';
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
    windowOpacity: clamp(
      Number(appearance?.windowOpacity ?? defaultSettings.appearance.windowOpacity),
      72,
      98
    ),
  };
}

function sanitizeGeneralSettings(
  general: Partial<GeneralSettings> | undefined
): GeneralSettings {
  const allowedLanguages = ['en', 'zh-CN', 'zh-TW'];
  const lang = general?.language;
  return {
    language: typeof lang === 'string' && allowedLanguages.includes(lang) ? lang : defaultSettings.general.language,
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
  applyWindowOpacity(appearance.windowOpacity);
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
