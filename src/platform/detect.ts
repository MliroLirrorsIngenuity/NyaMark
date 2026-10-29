export type Platform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'ios'
  | 'android'
  | 'other';

let cached: Platform | null = null;

/**
 * Every window gets its OS from the native side (see `build_window` in
 * `windows.rs`). The user agent is only consulted outside Tauri, e.g. a
 * plain browser on the dev server.
 */
function detect(): Platform {
  const native = (window as Window & { __NYAMARK_PLATFORM__?: string })
    .__NYAMARK_PLATFORM__;
  if (
    native === 'macos' ||
    native === 'windows' ||
    native === 'linux' ||
    native === 'ios' ||
    native === 'android'
  ) {
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

/** A phone or tablet: one window, no menu bar, no updater of its own. */
export function isMobilePlatform() {
  return getPlatform() === 'ios' || getPlatform() === 'android';
}

/** Apple's keyboards, an iPad's included: shortcuts are made with Command. */
export function usesCommandKey() {
  return getPlatform() === 'macos' || getPlatform() === 'ios';
}

export function isMacOS() {
  return getPlatform() === 'macos';
}

/** iOS with native screens around the page, which then draws only the document. */
export function isNativeShell() {
  return (
    getPlatform() === 'ios' &&
    (window as Window & { __NYAMARK_NATIVE_SHELL__?: boolean })
      .__NYAMARK_NATIVE_SHELL__ === true
  );
}
