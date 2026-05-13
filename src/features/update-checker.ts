import { getVersion } from '@tauri-apps/api/app';
import { type Platform, getPlatform } from '../platform/detect';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/MliroLirrorsIngenuity/NyaMark/releases?per_page=50';

type SemverIdentifier = number | string;

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: SemverIdentifier[];
};

type GitHubReleaseAsset = {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  assets?: unknown;
};

export type UpdateChannel = 'prerelease' | 'release';

export type UpdateAsset = {
  name: string;
  url: string;
  size: number | null;
  recommended: boolean;
};

export type UpdateRelease = {
  tagName: string;
  version: string;
  name: string;
  body: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
  assets: UpdateAsset[];
  suggestedAsset: UpdateAsset | null;
};

export type UpdateCheckResult = {
  currentVersion: string;
  currentChannel: UpdateChannel;
  latest: UpdateRelease | null;
};

function parseSemver(input: string): Semver | null {
  const normalized = input.trim().replace(/^v/i, '').split('+')[0];
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
  );
  if (!match) return null;

  const prerelease = (match[4] ?? '')
    .split('.')
    .filter(Boolean)
    .map<SemverIdentifier>((part) =>
      /^\d+$/.test(part) ? Number.parseInt(part, 10) : part
    );

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease,
  };
}

function compareIdentifiers(a: SemverIdentifier, b: SemverIdentifier) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.sign(a - b);
  }
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a.localeCompare(b);
}

function compareSemver(a: Semver, b: Semver) {
  const core = (['major', 'minor', 'patch'] as const)
    .map((key) => Math.sign(a[key] - b[key]))
    .find((diff) => diff !== 0);
  if (core) return core;

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const diff = compareIdentifiers(left, right);
    if (diff !== 0) return diff;
  }

  return 0;
}

function channelForVersion(version: Semver): UpdateChannel {
  return version.prerelease.length > 0 ? 'prerelease' : 'release';
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeAssets(
  release: GitHubRelease,
  platform: Platform
): UpdateAsset[] {
  if (!Array.isArray(release.assets)) return [];

  const assets = release.assets
    .map((asset: GitHubReleaseAsset) => {
      const name = readString(asset.name).trim();
      const url = readString(asset.browser_download_url).trim();
      if (!name || !url) return null;

      const size = typeof asset.size === 'number' ? asset.size : null;
      return {
        name,
        url,
        size,
        recommended: isRecommendedAsset(name, platform),
      };
    })
    .filter((asset): asset is UpdateAsset => asset !== null);

  return assets.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function isRecommendedAsset(name: string, platform: Platform) {
  const lower = name.toLowerCase();
  if (platform === 'windows') {
    return (
      lower.endsWith('.msi') ||
      lower.endsWith('.exe') ||
      lower.includes('windows')
    );
  }
  if (platform === 'macos') {
    return lower.endsWith('.dmg');
  }
  if (platform === 'linux') {
    return (
      lower.endsWith('.appimage') ||
      lower.endsWith('.deb') ||
      lower.endsWith('.rpm') ||
      lower.includes('linux')
    );
  }
  return false;
}

function toUpdateRelease(
  release: GitHubRelease,
  version: string,
  platform: Platform
): UpdateRelease | null {
  const tagName = readString(release.tag_name).trim();
  const url = readString(release.html_url).trim();
  if (!tagName || !url) return null;

  const assets = normalizeAssets(release, platform);
  return {
    tagName,
    version,
    name: readString(release.name).trim() || tagName,
    body: readString(release.body).trim(),
    url,
    publishedAt:
      readString(release.published_at).trim() ||
      readString(release.created_at).trim() ||
      null,
    prerelease: release.prerelease === true,
    assets,
    suggestedAsset: assets.find((asset) => asset.recommended) ?? null,
  };
}

export async function checkForGitHubUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getVersion();
  const currentSemver = parseSemver(currentVersion);
  if (!currentSemver) {
    throw new Error(`Current app version is not semver: ${currentVersion}`);
  }

  const currentChannel = channelForVersion(currentSemver);
  const platform = getPlatform();

  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub Releases request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('GitHub Releases response was not an array');
  }

  const channelPrerelease = currentChannel === 'prerelease';
  const candidates = payload
    .filter((release: GitHubRelease) => {
      if (release.draft === true) return false;
      return release.prerelease === channelPrerelease;
    })
    .map((release: GitHubRelease) => {
      const tagName = readString(release.tag_name);
      const version = tagName.replace(/^v/i, '');
      const parsed = parseSemver(tagName);
      if (!parsed || compareSemver(parsed, currentSemver) <= 0) return null;

      const updateRelease = toUpdateRelease(release, version, platform);
      if (!updateRelease) return null;

      return { parsed, release: updateRelease };
    })
    .filter(
      (candidate): candidate is { parsed: Semver; release: UpdateRelease } =>
        candidate !== null
    )
    .sort((a, b) => compareSemver(b.parsed, a.parsed));

  return {
    currentVersion,
    currentChannel,
    latest: candidates[0]?.release ?? null,
  };
}
