import {
  getWindowTheme,
  listenWindowThemeChange,
  setWindowTheme,
} from '../bridge/ipc/windows';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'nyamark-theme';

/**
 * Per-app theme controller.
 *
 * Behaviour:
 *  - On first launch we follow the OS / window's reported theme and keep
 *    listening for system changes — same as a fresh Typora install.
 *  - The moment the user flips the toolbar's light/dark toggle we treat
 *    that as a sticky preference: the choice is written to localStorage
 *    and the OS / window listeners stop overriding it. New windows pick
 *    the same value up at boot, so opening another file no longer snaps
 *    the editor back to the system theme.
 */
export class ThemeManager {
  private mode: ThemeMode;
  private listeners = new Set<(mode: ThemeMode) => void>();
  private readonly mediaQuery =
    window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  private readonly handleBrowserThemeChange = (event: MediaQueryListEvent) => {
    if (this.hasManualPreference()) return;
    this.setMode(event.matches ? 'dark' : 'light');
  };
  private nativeUnlisten: (() => void) | null = null;

  constructor() {
    const stored = this.readStoredPreference();
    if (stored) {
      this.mode = stored;
    } else {
      this.mode = this.mediaQuery?.matches ? 'dark' : 'light';
    }
    this.mediaQuery?.addEventListener('change', this.handleBrowserThemeChange);
    this.apply();
    void this.bindNativeTheme();
  }

  toggle() {
    const next: ThemeMode = this.mode === 'dark' ? 'light' : 'dark';
    this.setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (private browsing); the in-memory
      // mode is still correct for this window.
    }
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  onChange(listener: (mode: ThemeMode) => void) {
    this.listeners.add(listener);
    listener(this.mode);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private hasManualPreference(): boolean {
    return this.readStoredPreference() !== null;
  }

  private readStoredPreference(): ThemeMode | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  private async bindNativeTheme() {
    try {
      // The Tauri-reported theme should only act as a default fallback.
      // If the user has already chosen a theme, do nothing — that choice
      // wins until they toggle again (or clear localStorage).
      if (!this.hasManualPreference()) {
        const theme = await getWindowTheme();
        if (theme && !this.hasManualPreference()) {
          this.setMode(theme);
        }
      }

      this.nativeUnlisten = await listenWindowThemeChange((nextTheme) => {
        if (this.hasManualPreference()) return;
        this.setMode(nextTheme);
      });
    } catch {
      // Browser preview falls back to matchMedia only.
    }
  }

  private setMode(mode: ThemeMode) {
    if (this.mode === mode && document.documentElement.dataset.theme === mode) {
      return;
    }

    this.mode = mode;
    this.apply();
  }

  private apply() {
    document.documentElement.classList.toggle('dark', this.mode === 'dark');
    document.documentElement.dataset.theme = this.mode;
    document.documentElement.style.colorScheme = this.mode;
    void setWindowTheme(this.mode);
    window.dispatchEvent(
      new CustomEvent('nyamark:themechange', { detail: { mode: this.mode } })
    );
    this.listeners.forEach((listener) => listener(this.mode));
  }

  destroy() {
    this.mediaQuery?.removeEventListener(
      'change',
      this.handleBrowserThemeChange
    );
    this.nativeUnlisten?.();
    this.nativeUnlisten = null;
  }
}
