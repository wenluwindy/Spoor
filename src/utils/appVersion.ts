import { isTauriRuntime } from './isTauriRuntime';

/**
 * 当前应用版本号。
 *
 * 取自 Tauri 的包信息（也就是 `tauri.conf.json` 里的版本），而不是前端的常量——
 * 常量总有一天会忘了改，而装到用户机器上的版本号只有一个来源是可信的。
 * 浏览器调试时没有这个来源，返回空串。
 */
export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return '';
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}
