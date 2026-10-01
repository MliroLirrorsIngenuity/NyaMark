export type Platform = 'macos' | 'windows' | 'linux' | 'other';

let cached: Platform | null = null;

/**
 * Every window gets its OS from the native side (see `build_window` in
 * `windows.rs`). The user agent is only consulted outside Tauri, e.g. a
 * plain browser on the dev server.
 */
function detect(): Platform {
  const native = (window as Window & { __NYAMARK_PLATFORM__?: string })
    .__NYAMARK_PLATFORM__;
  if (native === 'macos' || native === 'windows' || native === 'linux') {
    return native;
  }
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw =
    nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
  if (/mac/i.test(raw)) return 'macos';
  if (/win/i.test(raw)) return 'windows';
  if (/linux/i.test(raw)) return 'linux';
  return 'other';
}

export function getPlatform(): Platform {
  if (cached === null) cached = detect();
  return cached;
}

export function isMacOS() {
  return getPlatform() === 'macos';
}
