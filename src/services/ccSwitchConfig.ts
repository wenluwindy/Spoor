import { isTauriRuntime } from '../utils/isTauriRuntime';

export type CcSwitchConfigReadResult =
  | { status: 'found'; config: unknown }
  | { status: 'not_installed' }
  | { status: 'read_failed'; detail: string };

/** 读取 cc-switch 的默认数据库；网页调试环境视为未安装。 */
export async function readCcSwitchConfig(): Promise<CcSwitchConfigReadResult> {
  if (!isTauriRuntime()) return { status: 'not_installed' };

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<CcSwitchConfigReadResult>('cc_switch_read_config');
  } catch (error) {
    return { status: 'read_failed', detail: String(error) };
  }
}
