import {
  getWindowTheme,
  listenWindowThemeChange,
  setWindowTheme,
} from '../bridge/ipc/windows';
import {
  type ThemePreference,
  getSettings,
  registerThemeApplier,
  updateSettings,
} from '../state/settings';

export type ThemeMode = 'light' | 'dark';

/** Where the toggle used to keep its choice before it moved into settings. */
const LEGACY_STORAGE_KEY = 'nyamark-theme';

/**
 * Resolves the theme preference from the settings into the light/dark mode
 * the document renders in, and keeps it applied.
 *
 *  - `auto` follows the operating system through the window's reported
 *    theme, with the `prefers-color-scheme` media query as the fallback
 *    outside Tauri.
 *  - The toolbar toggle writes an explicit `light` / `dark` preference to
 *    the settings, so every open window and every window opened later show
 *    the same theme. "Follow system" is available again from the settings
 *    dialog.
 */
export class ThemeManager {
  private preference: ThemePreference = 'auto';
  private systemMode: ThemeMode;
  private mode: ThemeMode | null = null;
  private appliedPreference: ThemePreference | null = null;
  private listeners = new Set<(mode: ThemeMode) => void>();
  private readonly mediaQuery =
    window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  private readonly handleBrowserThemeChange = (event: MediaQueryListEvent) => {
    this.setSystemMode(event.matches ? 'dark' : 'light');
  };
  private nativeUnlisten: (() => void) | null = null;

  constructor() {
    this.systemMode = this.mediaQuery?.matches ? 'dark' : 'light';
    this.mediaQuery?.addEventListener('change', this.handleBrowserThemeChange);
    registerThemeApplier((preference) => this.setPreference(preference));
    this.importLegacyPreference();
    void this.bindNativeTheme();
  }

  toggle() {
    const next: ThemeMode = this.getMode() === 'dark' ? 'light' : 'dark';
    // The applier registered above picks the change up synchronously.
    void updateSettings({ appearance: { theme: next } }).catch((error) => {
      console.error('Failed to save theme preference:', error);
    });
  }

  getMode(): ThemeMode {
    return this.mode ?? this.resolveMode();
  }

  onChange(listener: (mode: ThemeMode) => void) {
    this.listeners.add(listener);
    listener(this.getMode());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setPreference(preference: ThemePreference) {
    this.preference = preference;
    this.apply();
  }

  private setSystemMode(mode: ThemeMode) {
    this.systemMode = mode;
    this.apply();
  }

  private resolveMode(): ThemeMode {
    return this.preference === 'auto' ? this.systemMode : this.preference;
  }

  /** A choice made with the toggle before 1.0 moves into the settings once. */
  private importLegacyPreference() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      return;
    }
    if (stored !== 'light' && stored !== 'dark') return;
    if (getSettings().appearance.theme !== 'auto') return;
    void updateSettings({ appearance: { theme: stored } }).catch((error) => {
      console.error('Failed to migrate theme preference:', error);
    });
  }

  private async bindNativeTheme() {
    try {
      const theme = await getWindowTheme();
      if (theme) this.setSystemMode(theme);
      this.nativeUnlisten = await listenWindowThemeChange((nextTheme) => {
        this.setSystemMode(nextTheme);
      });
    } catch {
      // Browser preview falls back to matchMedia only.
    }
  }

  /**
   * A new preference is applied even where it shows the same mode: the window
   * is pinned to it or let go. Choosing "Follow system" while the system was
   * in the mode already shown left the window pinned, and the page with it,
   * till the app was opened again.
   */
  private apply() {
    const mode = this.resolveMode();
    const modeChanged =
      this.mode !== mode || document.documentElement.dataset.theme !== mode;
    if (!modeChanged && this.appliedPreference === this.preference) return;
    this.mode = mode;
    this.appliedPreference = this.preference;

    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    void this.syncWindowTheme(mode);
    if (modeChanged) {
      window.dispatchEvent(
        new CustomEvent('nyamark:themechange', { detail: { mode } })
      );
    }
    for (const listener of this.listeners) listener(mode);
  }

  /**
   * An explicit preference is pushed to the native window so its chrome
   * matches. `auto` hands the window back to the system: a forced theme is
   * process-wide on macOS (NSApp appearance) and suppresses the ThemeChanged
   * events on Windows, so leaving it set would pin every window to whatever
   * the system looked like at the first apply.
   */
  private async syncWindowTheme(mode: ThemeMode) {
    try {
      if (this.preference !== 'auto') {
        await setWindowTheme(mode);
        return;
      }
      await setWindowTheme(null);
      // Windows reports no event for the reset itself; read the system
      // theme back in case it changed while the preference was forced.
      const theme = await getWindowTheme();
      if (theme && this.preference === 'auto') this.setSystemMode(theme);
    } catch {
      // Browser preview: no native window to sync.
    }
  }

  destroy() {
    registerThemeApplier(null);
    this.mediaQuery?.removeEventListener(
      'change',
      this.handleBrowserThemeChange
    );
    this.nativeUnlisten?.();
    this.nativeUnlisten = null;
  }
}
