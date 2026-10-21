import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_VERSION } from '../../constants/version';
import {
  isNewerVersion,
  isUpdateAssetCompatible,
  checkLatestRelease,
  normalizeVersion,
  selectInstallerAsset,
  selectPortableAsset,
  shouldReplaceDownloadedUpdate,
  versionFromAssetName,
  fetchRepoStats,
} from '../updateChecker';

// 固定正式版测试环境，避免 CI 注入测试版版本号后将稳定版响应误构造成预发布版本。
vi.mock('../../constants/version', () => ({ APP_VERSION: '1.9.1' }));

describe('updateChecker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isNewerVersion', () => {
    it('returns true when latest is greater than current', () => {
      expect(isNewerVersion('1.4.6', '1.4.5')).toBe(true);
      expect(isNewerVersion('v1.5.0', '1.4.5')).toBe(true);
      expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    });

    it('returns false when latest is equal or lower than current', () => {
      expect(isNewerVersion('1.4.5', '1.4.5')).toBe(false);
      expect(isNewerVersion('1.4.4', '1.4.5')).toBe(false);
      expect(isNewerVersion('v1.3.9', '1.4.5')).toBe(false);
    });

    it('compares prerelease versions using semver rules', () => {
      expect(isNewerVersion('1.5.0-beta.2', '1.5.0-beta.1')).toBe(true);
      expect(isNewerVersion('1.5.0', '1.5.0-beta.9')).toBe(true);
      expect(isNewerVersion('1.5.0-beta.1', '1.5.0')).toBe(false);
    });

    it('rejects malformed versions instead of treating them as zeroes', () => {
      expect(isNewerVersion('1.x.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('release-latest', '1.0.0')).toBe(false);
      expect(normalizeVersion('v2.3.4+build.7')).toBe('2.3.4');
      expect(normalizeVersion('not-a-version')).toBeNull();
    });
  });

  describe('versionFromAssetName', () => {
    it.each([
      'coolapk-desktop_1.29.0_x64.dmg',
      'coolapk-desktop_1.29.0_aarch64-123-456.dmg',
      'coolapk-desktop_1.29.0_amd64.AppImage',
      'coolapk-desktop_1.29.0_amd64-123-456.appimage',
      'coolapk-desktop_1.29.0_arm64.deb',
      'coolapk-desktop-1.29.0-1.x86_64.rpm',
      'coolapk-desktop-1.29.0-1.x86_64-123-456.rpm',
    ])('extracts macOS/Linux release and cached package versions: %s', (name) => {
      expect(versionFromAssetName(name)).toBe('1.29.0');
    });

    it('preserves prerelease versions in macOS and RPM package names', () => {
      expect(versionFromAssetName('coolapk-desktop_1.29.0-beta.2_aarch64.dmg')).toBe('1.29.0-beta.2');
      expect(versionFromAssetName('coolapk-desktop-1.29.0-beta.2-1.x86_64.rpm')).toBe('1.29.0-beta.2');
    });
    it('extracts versions from downloaded files with updater suffixes', () => {
      expect(versionFromAssetName('coolapk-desktop_1.20.2_x64-portable-123-456.exe'))
        .toBe('1.20.2');
      expect(versionFromAssetName('coolapk-desktop_1.20.2_x64-setup-123-456.exe'))
        .toBe('1.20.2');
    });
  });

  describe('isUpdateAssetCompatible', () => {
    it('rejects mismatched Linux package types and architectures', () => {
      const platform = { os: 'linux', arch: 'x86_64' };
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.deb', platform, 'deb')).toBe(true);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.deb', platform, 'portable')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_arm64.deb', platform, 'deb')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.AppImage', platform, 'unsupported')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.AppImage', platform, 'installer')).toBe(false);
    });
    it('validates architecture and package type for cached updater file names', () => {
      const platform = { os: 'windows' as const, arch: 'x86_64' as const };
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_x64-portable-123-456.exe',
        platform,
        'portable'
      )).toBe(true);
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_arm64-portable-123-456.exe',
        platform,
        'portable'
      )).toBe(false);
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_x64-setup-123-456.exe',
        platform,
        'portable'
      )).toBe(false);
    });
  });

  describe('shouldReplaceDownloadedUpdate', () => {
    it('reuses the downloaded package when GitHub is unavailable or not newer', () => {
      expect(shouldReplaceDownloadedUpdate('1.20.2', '', false)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.2', true)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.1', true)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', 'invalid', true)).toBe(false);
    });

    it('replaces it only when GitHub has a newer compatible package', () => {
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.3', true)).toBe(true);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.3', false)).toBe(false);
    });
  });

  describe('checkLatestRelease', () => {
    it.each([
      ['macos', 'x86_64', 'installer', 'coolapk-desktop_9.9.9_x64.dmg'],
      ['macos', 'aarch64', 'installer', 'coolapk-desktop_9.9.9_aarch64.dmg'],
      ['linux', 'x86_64', 'portable', 'coolapk-desktop_9.9.9_amd64.AppImage'],
      ['linux', 'x86_64', 'deb', 'coolapk-desktop_9.9.9_amd64.deb'],
      ['linux', 'x86_64', 'rpm', 'coolapk-desktop-9.9.9-1.x86_64.rpm'],
    ] as const)('selects %s %s %s package', async (os, arch, packageType, name) => {
      const names = [
        'coolapk-desktop_9.9.9_x64.dmg', 'coolapk-desktop_9.9.9_aarch64.dmg',
        'coolapk-desktop_9.9.9_amd64.AppImage', 'coolapk-desktop_9.9.9_amd64.deb',
        'coolapk-desktop-9.9.9-1.x86_64.rpm', 'coolapk-desktop_9.9.9_arm64-setup.exe',
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: names.map((name) => ({
          name, browser_download_url: `https://github.com/download/${name}`,
        })) }),
      } as Response);
      const info = await checkLatestRelease('stable', { os, arch }, packageType);
      expect(info.installerName).toBe(name);
      expect(info.packageType).toBe(packageType);
    });

    it.each(['macos', 'linux'])('rejects older version assets on %s', async (os) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: [
          { name: 'coolapk-desktop_9.9.8_x64.dmg', browser_download_url: 'old-macos' },
          { name: 'coolapk-desktop_9.9.8_amd64.AppImage', browser_download_url: 'old-linux' },
        ] }),
      } as Response);
      const info = await checkLatestRelease('stable', { os, arch: 'x86_64' }, os === 'linux' ? 'portable' : 'installer');
      expect(info.installerUrl).toBeUndefined();
    });
    it('fetches stable latest release and matches installer URL', async () => {
      const mockRelease = {
        tag_name: 'v9.9.9',
        body: '这是升级日志说明',
        html_url: 'https://github.com/daimiaopeng/coolapk-desktop/releases/tag/v9.9.9',
        assets: [
          {
            name: 'coolapk-desktop_9.9.9_x64-setup.exe',
            browser_download_url: 'https://github.com/download/coolapk-desktop_9.9.9_x64-setup.exe',
          },
          {
            name: 'coolapk-desktop_9.9.9_arm64-setup.exe',
            browser_download_url: 'https://github.com/download/coolapk-desktop_9.9.9_arm64-setup.exe',
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockRelease,
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(true);
      expect(info.latestVersion).toBe('v9.9.9');
      expect(info.installerUrl).toBe('https://github.com/download/coolapk-desktop_9.9.9_x64-setup.exe');
      expect(info.releaseNotes).toBe('这是升级日志说明');
    });

    it('does not select an installer from a different release version', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v2.0.0',
          assets: [
            {
              name: 'coolapk-desktop_1.9.0_x64-setup.exe',
              browser_download_url: 'https://github.com/download/old.exe',
            },
          ],
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(true);
      expect(info.installerUrl).toBeUndefined();
    });

    it('matches the current architecture portable executable', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v9.9.9',
          assets: [
            {
              name: 'coolapk-desktop_9.9.9_x64-portable.exe',
              browser_download_url: 'https://github.com/download/x64-portable.exe',
            },
            {
              name: 'coolapk-desktop_9.9.9_arm64-portable.exe',
              browser_download_url: 'https://github.com/download/arm64-portable.exe',
            },
          ],
        }),
      } as Response);

      const info = await checkLatestRelease(
        'stable',
        { os: 'windows', arch: 'aarch64' },
        'portable'
      );
      expect(info.installerUrl).toBe('https://github.com/download/arm64-portable.exe');
      expect(info.packageType).toBe('portable');
    });

    it('returns remote release body as changelog when current version is latest and remote has body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${APP_VERSION}`,
          body: '1.9.1 远程说明',
          published_at: '2026-08-21T11:51:14Z',
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(false);
      expect(info.releaseNotes).toBe('1.9.1 远程说明');
      expect(info.publishedAt).toBeDefined();
    });

    it('returns builtin changelog when current version is latest and remote body is empty', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${APP_VERSION}`,
          body: '',
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(false);
      expect(info.releaseNotes).toBe('暂无当前版本的更新日志。');
      expect(info.publishedAt).toBeUndefined();
    });
  });

  describe('发布来源回退', () => {
    const release = {
      tag_name: 'v9.9.9',
      assets: [
        {
          name: 'coolapk-desktop_9.9.9_x64-setup.exe',
          browser_download_url: 'https://github.com/download/coolapk-desktop_9.9.9_x64-setup.exe',
        },
      ],
    };

    /** 构造只对指定前缀成功的 fetch 替身，同时记录被请求的 URL 顺序。 */
    function mockSources(routes: Array<[string, () => Response]>) {
      const seen: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = String(input);
        seen.push(url);
        for (const [prefix, make] of routes) {
          if (url.startsWith(prefix)) return make();
        }
        throw new TypeError('Failed to fetch');
      }) as typeof fetch);
      return seen;
    }

    const ok = (data: any) => ({ ok: true, status: 200, json: async () => data } as Response);
    const fail = (status: number) => ({ ok: false, status, json: async () => ({}) } as Response);

    it('直连配额耗尽时回退镜像，匿名 403 不再是致命错误', async () => {
      // 这正是启动时看到的现象：api.github.com 返回 403 rate limit exceeded。
      const seen = mockSources([
        ['https://api.github.com', () => fail(403)],
        ['https://gh-proxy.com/', () => ok(release)],
      ]);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(true);
      expect(info.latestVersion).toBe('v9.9.9');
      expect(seen.some((url) => url.startsWith('https://gh-proxy.com/'))).toBe(true);
    });

    it('fork 尚未发布时回退上游仓库，避免更新检查整体失效', async () => {
      // shilonyin/cool-desktop 的 releases 目前是空数组，latest 返回 404。
      const seen = mockSources([
        ['https://api.github.com/repos/shilonyin/cool-desktop/releases', () => fail(404)],
        ['https://api.github.com/repos/daimiaopeng/coolapk-desktop/releases', () => ok(release)],
      ]);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.latestVersion).toBe('v9.9.9');
      expect(seen[0]).toContain('shilonyin/cool-desktop');
      expect(seen.some((url) => url.includes('daimiaopeng/coolapk-desktop'))).toBe(true);
    });

    it('两个来源都失败时抛出错误，交给上层记为 check_failed', async () => {
      mockSources([
        ['https://api.github.com', () => fail(403)],
        ['https://gh-proxy.com/', () => fail(503)],
      ]);

      await expect(checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' }))
        .rejects.toThrow(/GitHub API HTTP/);
    });

    it('404 不重试镜像，因为换来源答案一样', async () => {
      const seen = mockSources([['https://api.github.com', () => fail(404)]]);

      await expect(checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' }))
        .rejects.toThrow(/404/);
      expect(seen.every((url) => url.startsWith('https://api.github.com'))).toBe(true);
    });

    it('fork 的 releases 是空数组时回退上游，不把历史渠道版本清空', async () => {
      // fork 继承了标签但没有任何 release：`?per_page=100` 返回 []，
      // 若把它当作成功结果，beta 渠道会一条候选都拿不到。
      const betaRelease = { tag_name: 'v9.9.9-beta.1', prerelease: true, assets: [] };
      mockSources([
        [
          'https://api.github.com/repos/shilonyin/cool-desktop/releases?per_page=100',
          () => ok([]),
        ],
        [
          'https://api.github.com/repos/daimiaopeng/coolapk-desktop/releases?per_page=100',
          () => ok([betaRelease]),
        ],
        ['https://api.github.com/repos/shilonyin/cool-desktop/releases/latest', () => fail(404)],
        [
          'https://api.github.com/repos/daimiaopeng/coolapk-desktop/releases/latest',
          // 稳定版 latest 比测试版旧，排序后应保留测试版候选。
          () => ok({ tag_name: 'v9.9.8', assets: [] }),
        ],
      ]);

      const info = await checkLatestRelease('beta', { os: 'windows', arch: 'x86_64' });
      expect(info.latestVersion).toBe('v9.9.9-beta.1');
    });

    it('渠道版本比已装版本旧时，按仓库顺序读取当前版本 tag 详情', async () => {
      // 已装版本等于渠道最新版时不会走这里；只有渠道最新版更旧才需要回头读已装版本。
      const currentRelease = {
        tag_name: `v${APP_VERSION}`,
        body: '当前版本的更新日志',
        published_at: '2026-10-15T03:00:00Z',
        html_url: `https://github.com/daimiaopeng/coolapk-desktop/releases/tag/v${APP_VERSION}`,
      };
      mockSources([
        ['https://api.github.com/repos/shilonyin/cool-desktop/releases/latest', () => ok({ tag_name: 'v1.0.0', assets: [] })],
        [
          `https://api.github.com/repos/shilonyin/cool-desktop/releases/tags/v${APP_VERSION}`,
          () => fail(404),
        ],
        [
          `https://api.github.com/repos/daimiaopeng/coolapk-desktop/releases/tags/v${APP_VERSION}`,
          () => ok(currentRelease),
        ],
      ]);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(false);
      expect(info.releaseNotes).toBe('当前版本的更新日志');
      expect(info.downloadUrl).toContain('daimiaopeng/coolapk-desktop');
      expect(info.publishedAt).toBeTruthy();
    });
  });

  describe('社区数据展示', () => {
    it('默认读上游仓库，避免展示 fork 的全零数据', async () => {
      const seen: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        seen.push(String(input));
        return { ok: true, status: 200, json: async () => ({ stargazers_count: 1, forks_count: 2, open_issues_count: 3 }) } as Response;
      }) as typeof fetch);

      const stats = await fetchRepoStats();
      expect(stats.stargazers_count).toBe(1);
      expect(seen[0]).toContain('daimiaopeng/coolapk-desktop');
    });
  });

  describe('selectInstallerAsset', () => {
    const assets = [
      { name: 'coolapk-desktop_9.9.9_x64-setup.exe', browser_download_url: 'x64-url' },
      { name: 'coolapk-desktop_9.9.9_arm64-setup.exe', browser_download_url: 'arm64-url' },
    ];

    it('selects the x64 installer on Windows x86_64', () => {
      expect(selectInstallerAsset(assets, { os: 'windows', arch: 'x86_64' })?.browser_download_url)
        .toBe('x64-url');
    });

    it('selects the arm64 installer on Windows aarch64', () => {
      expect(selectInstallerAsset(assets, { os: 'windows', arch: 'aarch64' })?.browser_download_url)
        .toBe('arm64-url');
    });
  });

  describe('selectPortableAsset', () => {
    const assets = [
      { name: 'coolapk-desktop_9.9.9_x64-portable.exe', browser_download_url: 'x64-url' },
      { name: 'coolapk-desktop_9.9.9_arm64-portable.exe', browser_download_url: 'arm64-url' },
      { name: 'coolapk-desktop_9.9.9_x64-setup.exe', browser_download_url: 'setup-url' },
    ];

    it('selects only the matching architecture portable executable', () => {
      expect(selectPortableAsset(assets, { os: 'windows', arch: 'x86_64' })?.browser_download_url)
        .toBe('x64-url');
      expect(selectPortableAsset(assets, { os: 'windows', arch: 'aarch64' })?.browser_download_url)
        .toBe('arm64-url');
    });
  });
});
