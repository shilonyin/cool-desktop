import { APP_VERSION } from '../constants/version';

/** 反馈统一走项目 Issues，不指向任何个人账号。 */
export const GITHUB_PROJECT_URL = 'https://github.com/shilonyin/cool-desktop';
export const GITHUB_ISSUES_URL = `${GITHUB_PROJECT_URL}/issues`;

export function getFeedbackTemplate(): string {
  let osName = 'Windows';
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    // Android UA 同时包含 Linux，必须先识别 Android。
    if (/android/i.test(ua)) {
      osName = 'Android';
    } else if (/iphone|ipad|ipod/i.test(ua)
      || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
      // iOS UA 包含 Mac OS；iPad 桌面模式会使用 Macintosh UA。
      osName = 'iOS';
    } else if (ua.includes('Macintosh') || ua.includes('Mac OS')) {
      osName = 'macOS';
    } else if (ua.includes('Linux')) {
      osName = 'Linux';
    } else if (ua.includes('Windows')) {
      osName = 'Windows';
    }
  }

  return `【酷安客户端问题反馈】
- 客户端版本：v${APP_VERSION}
- 操作系统：${osName}
- 问题描述：
- 复现步骤：`;
}

/**
 * 生成预填版本与系统的 Issue 链接。
 *
 * 反馈不再私信任何个人账号：Issue 是公开可追溯的，也便于其他使用者检索同类问题。
 */
export function createFeedbackIssueUrl(): string {
  const url = new URL(`${GITHUB_ISSUES_URL}/new`);
  url.searchParams.set('title', `酷安客户端问题反馈 v${APP_VERSION}`);
  url.searchParams.set('body', getFeedbackTemplate());
  return url.toString();
}
