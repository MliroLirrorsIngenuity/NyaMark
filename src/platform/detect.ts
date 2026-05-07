export type Platform = 'macos' | 'windows' | 'linux' | 'other';

let cached: Platform | null = null;

function detect(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const raw = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
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
