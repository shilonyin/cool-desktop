import { APP_VERSION } from '../constants/version';
import type { UpdateChannel } from '../types/settings';
import { getPlatformInfo, type PlatformInfo } from './platform';

export { APP_VERSION };

/** 更新检查的来源仓库，按顺序尝试。上游已停止维护，优先检查本分支的 fork。 */
export const UPDATE_REPOS = ['shilonyin/cool-desktop', 'daimiaopeng/coolapk-desktop'];

/** fork 可能还没发布过 release，也没有社区数据；这类展示仍读上游仓库。 */
const UPSTREAM_REPO = UPDATE_REPOS[UPDATE_REPOS.length - 1];

/**
 * GitHub API 取址顺序：直连优先，失败后回退镜像。
 *
 * 匿名请求的配额按出口 IP 计算（每小时 60 次），同一网络下的浏览器、其他工具和
 * 本应用共用这份配额，启动顺手检查几次就可能撞上 `HTTP 403 rate limit exceeded`。
 * 镜像由第三方服务器向 GitHub 发起请求，出口 IP 与本地不同，因此能绕开配额耗尽。
 * 镜像返回的同样是 GitHub API 的原始 JSON，响应结构完全一致。
 */
const API_ORIGINS = ['https://api.github.com', 'https://gh-proxy.com/https://api.github.com'];

const releasesPath = (repo: string) => `/repos/${repo}/releases`;

const RELEASES_PAGE = `https://github.com/${UPSTREAM_REPO}/releases`;

/**
 * 更新日志与发布页缺省指向。
 *
 * fork 的 `releases` 目前是空数组，指向它只会打开一个没有任何版本的页面；
 * 实际的分发仍在上游仓库，所以兜底沿用上游发布页。
 */
export function updateReleasePageUrl(): string {
  return RELEASES_PAGE;
}

type ReleaseResponse = { ok: boolean; status: number; data?: any };

/**
 * 按 API_ORIGINS 顺序请求同一个 GitHub API 路径，返回第一个成功的响应。
 *
 * 只有 404 会立即返回：它表示"该仓库确实没有这份资源"，换来源答案一样。
 * 其余失败（403 配额、5xx、网络不可达）都继续尝试下一个来源。
 */
async function fetchReleaseApi(path: string): Promise<ReleaseResponse> {
  let lastStatus = 0;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (response.ok) return { ok: true, status: response.status, data: await response.json() };
      lastStatus = response.status;
      if (response.status === 404) return { ok: false, status: 404 };
    } catch {
      // 网络不可达：继续尝试下一个来源。
    }
  }
  return { ok: false, status: lastStatus };
}

/**
 * 读取仓库概况（星标/分支/issue 数），供设置页展示。
 *
 * 与更新检查共用同一套来源回退，避免额外打满匿名配额；失败时返回 undefined，
 * 调用方据此隐藏该行即可。
 *
 * 默认读上游仓库：本分支的 fork 是新建的转发仓库，社区数据全是 0，
 * 展示出来只会让人以为请求失败。
 */
export async function fetchRepoStats(repo = UPSTREAM_REPO): Promise<any | undefined> {
  const response = await fetchReleaseApi(`/repos/${repo}`);
  return response.ok ? response.data : undefined;
}

/**
 * 依次向候选仓库请求 `latest`，返回第一个有发布的仓库。
 *
 * 本分支的 fork 可能还没发布过 release（`releases` 返回空数组，`latest` 返回 404）。
 * 这种情况下回退到上游仓库，让更新检查保持可用；等 fork 发布了自己的版本后，
 * 会自动优先采用 fork 的版本。
 */
async function fetchLatestRelease(): Promise<ReleaseResponse> {
  let last: ReleaseResponse = { ok: false, status: 0 };
  for (const repo of UPDATE_REPOS) {
    last = await fetchReleaseApi(`${releasesPath(repo)}/latest`);
    if (last.ok) return last;
    // 配额或网络错误说明排除掉这个仓库也没用，直接上报。
    if (last.status !== 404) return last;
  }
  return last;
}

/**
 * 读取某个版本的完整发布信息（更新日志、发布日期、页面链接）。
 *
 * 同样按仓库顺序尝试：fork 的发布列表可能为空，此时标签也只存在于上游。
 */
async function fetchReleaseByTag(tag: string): Promise<ReleaseResponse> {
  let last: ReleaseResponse = { ok: false, status: 0 };
  for (const repo of UPDATE_REPOS) {
    last = await fetchReleaseApi(`${releasesPath(repo)}/tags/${tag}`);
    if (last.ok) return last;
    if (last.status !== 404) return last;
  }
  return last;
}

/**
 * 读取发布列表，返回第一个非空的仓库结果。
 *
 * 空数组不算成功：fork 继承了上游的标签但没有任何 release，
 * 用它裁剪渠道列表会把历史版本全部丢掉。
 */
async function fetchReleaseList(): Promise<ReleaseResponse> {
  let last: ReleaseResponse = { ok: false, status: 0 };
  for (const repo of UPDATE_REPOS) {
    last = await fetchReleaseApi(`${releasesPath(repo)}?per_page=100`);
    if (last.ok && Array.isArray(last.data) && last.data.length) return last;
    if (!last.ok && last.status !== 404) return last;
  }
  return last;
}

export type UpdateInfo = {
  hasNew: boolean;
  latestVersion?: string;
  releaseNotes?: string;
  publishedAt?: string;
  downloadUrl?: string;
  installerUrl?: string;
  installerName?: string;
  packageType?: UpdatePackageType;
};

export type UpdatePackageType = 'installer' | 'portable' | 'deb' | 'rpm' | 'unsupported';

export function isUpdatePackageType(value: unknown): value is UpdatePackageType {
  return typeof value === 'string' && ['installer', 'portable', 'deb', 'rpm', 'unsupported'].includes(value);
}

export type InstallerAsset = {
  name?: string;
  browser_download_url?: string;
};

export function isUpdateAssetCompatible(
  name: string,
  platform: PlatformInfo,
  packageType: UpdatePackageType
): boolean {
  if (platform.os === 'macos' || platform.os === 'linux') {
    if (!versionFromAssetName(name) || !/^coolapk-desktop[-_]/i.test(name)) return false;
    const archPattern = platform.arch === 'aarch64'
      ? /(?:^|[-_.])(?:arm64|aarch64)(?=[-_.]|$)/i
      : platform.arch === 'x86_64'
        ? /(?:^|[-_.])(?:x64|amd64|x86_64)(?=[-_.]|$)/i
        : null;
    if (!archPattern?.test(name)) return false;
    if (platform.os === 'macos') return packageType === 'installer' && /\.dmg$/i.test(name);
    if (packageType === 'portable') return /\.AppImage$/i.test(name);
    return (packageType === 'deb' && /\.deb$/i.test(name))
      || (packageType === 'rpm' && /\.rpm$/i.test(name));
  }
  if (platform.os === 'android') {
    return packageType === 'installer'
      && platform.arch === 'aarch64'
      && /^coolapk-v?.+-android-arm64(?:-\d+-\d+)?\.apk$/i.test(name)
      && Boolean(versionFromAssetName(name));
  }
  if (platform.os !== 'windows') return false;
  // 线性拆分名称，避免可重叠重复分组在长文件名上产生大量回溯。
  if (!name.toLowerCase().endsWith('.exe')) return false;
  const parts = name.slice(0, -4).toLowerCase().split(/[-_]/);
  const index = parts.lastIndexOf(packageType === 'portable' ? 'portable' : 'setup');
  if (index <= 0 || parts.slice(index + 1).some(part => part.includes('.')) || parts[parts.length - 1] === '') return false;
  const archPattern = platform.arch === 'aarch64'
    ? /(?:^|[-_])(?:arm64|aarch64)(?=[-_.]|$)/i
    : platform.arch === 'x86_64'
      ? /(?:^|[-_])(?:x64|amd64)(?=[-_.]|$)/i
      : null;
  return Boolean(archPattern?.test(name));
}

export function selectInstallerAsset(
  assets: InstallerAsset[],
  platform: PlatformInfo
): InstallerAsset | undefined {
  if (platform.os === 'macos' || platform.os === 'android') {
    return assets.find((asset) => asset.name && asset.browser_download_url
      && isUpdateAssetCompatible(asset.name, platform, 'installer'));
  }
  if (platform.os !== 'windows') return undefined;
  const candidates = assets.filter(
    (asset) => asset.name && /[-_]setup\.exe$/i.test(asset.name) && asset.browser_download_url
  );
  const archPattern = platform.arch === 'aarch64'
    ? /(?:^|[-_])(?:arm64|aarch64)(?=[-_.]|$)/i
    : platform.arch === 'x86_64'
      ? /(?:^|[-_])(?:x64|amd64)(?=[-_.]|$)/i
      : null;
  if (!archPattern) return undefined;
  const exact = candidates.find((asset) => archPattern.test(asset.name || ''));
  if (exact) return exact;
  const hasExplicitArch = candidates.some((asset) =>
    /(?:^|[-_])(?:x64|amd64|arm64|aarch64)(?=[-_.]|$)/i.test(asset.name || '')
  );
  return hasExplicitArch ? undefined : candidates[0];
}

export function selectPortableAsset(
  assets: InstallerAsset[],
  platform: PlatformInfo
): InstallerAsset | undefined {
  if (platform.os === 'linux') {
    return assets.find((asset) => asset.name && asset.browser_download_url
      && isUpdateAssetCompatible(asset.name, platform, 'portable'));
  }
  if (platform.os !== 'windows') return undefined;
  const candidates = assets.filter(
    (asset) => asset.name && /[-_]portable\.exe$/i.test(asset.name) && asset.browser_download_url
  );
  const archPattern = platform.arch === 'aarch64'
    ? /(?:^|[-_])(?:arm64|aarch64)(?=[-_.]|$)/i
    : platform.arch === 'x86_64'
      ? /(?:^|[-_])(?:x64|amd64)(?=[-_.]|$)/i
      : null;
  if (!archPattern) return undefined;
  return candidates.find((asset) => archPattern.test(asset.name || ''));
}

export function isNewerVersion(latest: string, current = APP_VERSION) {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);
  return Boolean(latestVersion && currentVersion && compareVersions(latestVersion, currentVersion) > 0);
}

export function shouldReplaceDownloadedUpdate(
  downloadedVersion: string,
  latestVersion: string,
  hasCompatibleAsset: boolean
): boolean {
  return hasCompatibleAsset && isNewerVersion(latestVersion, downloadedVersion);
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i);
  if (!match) return null;
  const parts = [match[1], match[2], match[3]].map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function normalizeVersion(value: string): string | null {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const suffix = parsed.prerelease.length ? `-${parsed.prerelease.join('.')}` : '';
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${suffix}`;
}

export function isVersionAllowedInChannel(version: string, channel: UpdateChannel): boolean {
  const parsed = parseVersion(version);
  return Boolean(parsed && (channel === 'beta' || parsed.prerelease.length === 0));
}

async function pickRelease(channel: UpdateChannel, platform: PlatformInfo, packageType: UpdatePackageType): Promise<any> {
  if (channel === 'beta') {
    // 稳定版单独读取，避免大量测试版挤出列表窗口。
    const page = await fetchReleaseList();
    if (!page.ok || !Array.isArray(page.data)) throw new Error(`GitHub API HTTP ${page.status || 'unreachable'}`);
    const releases = page.data;
    const stable = await fetchLatestRelease();
    if (stable.ok) releases.push(stable.data);
    else if (stable.status !== 404) throw new Error(`GitHub API HTTP ${stable.status}`);
    const candidates = releases.filter((release) => !release.draft && normalizeVersion(release.tag_name)
      && (!release.prerelease || /^v?\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(release.tag_name)));
    candidates.sort((a, b) => isNewerVersion(a.tag_name, b.tag_name) ? -1 : isNewerVersion(b.tag_name, a.tag_name) ? 1 : 0);
    if (!candidates.length) throw new Error('未获取到任何发布版本');
    return candidates.find((release) => selectReleaseAsset(release, platform, packageType)) || candidates[0];
  }
  const response = await fetchLatestRelease();
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status || 'unreachable'}`);
  const release = response.data;
  if (release.draft || release.prerelease || !isVersionAllowedInChannel(release.tag_name, 'stable')) {
    throw new Error('稳定版发布信息无效');
  }
  return release;
}

export function formatReleaseDate(dateStr?: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(dateStr)) return dateStr;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d} ${hh}:${mm}`;
  } catch {
    return dateStr;
  }
}

export function getCurrentVersionChangelog(version = APP_VERSION, remoteBody?: string): string {
  const cleanRemote = (remoteBody || '').trim();
  if (cleanRemote) {
    return cleanRemote;
  }
  return '暂无当前版本的更新日志。';
}

function selectReleaseAsset(release: any, currentPlatform: PlatformInfo, packageType: UpdatePackageType): InstallerAsset | undefined {
  const tagName = release.tag_name || '';
  // 按平台、发行方式、架构和 release 版本选择更新包。
  const assets: InstallerAsset[] = release.assets || [];
  const candidates = assets.filter((asset) => {
    if (!asset.name || !asset.browser_download_url) return false;
    if (currentPlatform.os === 'macos' || currentPlatform.os === 'linux') {
      return isUpdateAssetCompatible(asset.name, currentPlatform, packageType);
    }
    if (currentPlatform.os === 'android') {
      return packageType === 'installer' && /-android-arm64\.apk$/i.test(asset.name);
    }
    return packageType === 'portable'
      ? /[-_]portable\.exe$/i.test(asset.name)
      : /[-_]setup\.exe$/i.test(asset.name);
  });
  const tagVersion = normalizeVersion(tagName);
  const versionedCandidates = candidates.filter((asset) => Boolean(asset.name && versionFromAssetName(asset.name)));
  const versionMatched = candidates.filter(
    (asset) => Boolean(asset.name && tagVersion && versionFromAssetName(asset.name) === tagVersion)
  );
  // 如果资源名明确带版本号但与 release 不一致，禁止误下载旧安装包；
  // 只有资源名完全不含版本号时才允许兼容旧发布格式。
  const validCandidates = versionMatched.length > 0
    ? versionMatched
    : versionedCandidates.length > 0
      ? []
      : candidates;

  const selectedAsset = (packageType === 'deb' || packageType === 'rpm'
    ? validCandidates[0]
    : packageType === 'portable'
    ? selectPortableAsset(validCandidates, currentPlatform)
    : selectInstallerAsset(validCandidates, currentPlatform));
  return selectedAsset;

}

export async function checkLatestRelease(
  channel: UpdateChannel = 'stable',
  platform?: PlatformInfo,
  packageType: UpdatePackageType = 'installer'
): Promise<UpdateInfo> {
  const currentPlatform = platform ?? await getPlatformInfo();
  const release = await pickRelease(channel, currentPlatform, packageType);
  const tagName = release.tag_name || '';
  const hasNew = Boolean(normalizeVersion(tagName)) && isNewerVersion(tagName);

  const selectedAsset = selectReleaseAsset(release, currentPlatform, packageType);
  const installerUrl = selectedAsset?.browser_download_url;

  // 渠道最新版本可能比已安装版本旧，此时日志、日期和链接必须读取当前安装版本。
  let notesRelease = release;
  if (!hasNew && normalizeVersion(tagName) !== normalizeVersion(APP_VERSION)) {
    notesRelease = null;
    try {
      const response = await fetchReleaseByTag(`v${encodeURIComponent(APP_VERSION)}`);
      if (response.ok) {
        const currentRelease = response.data;
        if (!currentRelease.draft && normalizeVersion(currentRelease.tag_name) === normalizeVersion(APP_VERSION)) notesRelease = currentRelease;
      }
    } catch {
      // 当前版本日志暂时不可用时不冒用其他版本日志，也不影响更新检查结果。
    }
  }
  const releaseNotes = hasNew
    ? (release.body ? release.body.trim() : '暂无特别更新说明')
    : getCurrentVersionChangelog(APP_VERSION, notesRelease?.body);

  const publishedAt = notesRelease?.published_at ? formatReleaseDate(notesRelease.published_at) : undefined;

  return {
    hasNew,
    latestVersion: tagName || '最新发布',
    releaseNotes,
    publishedAt,
    downloadUrl: notesRelease?.html_url || RELEASES_PAGE,
    installerUrl,
    installerName: selectedAsset?.name,
    packageType,
  };
}

export function versionFromAssetName(name: string) {
  const desktopMatch = name.match(/^coolapk-desktop[_-](v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:_(?:x64|amd64|x86_64|arm64|aarch64)|-\d+\.(?:x86_64|aarch64))/i);
  if (desktopMatch) return normalizeVersion(desktopMatch[1]) || undefined;
  const androidMatch = name.match(/^coolapk-(v?.+)-android-(?:arm64|aarch64)(?:-\d+-\d+)?\.apk$/i);
  if (androidMatch) return normalizeVersion(androidMatch[1]) || undefined;
  const match = name.match(/(?:^|[-_])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=[-_]|$)/i);
  return match ? normalizeVersion(match[1]) : undefined;
}
