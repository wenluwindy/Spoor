import { mediaExport } from '../services/mediaStore';
import { isTauriRuntime } from './isTauriRuntime';

/**
 * 把文件存储里的一份媒体另存到用户选定的位置。
 *
 * 原本只长在设置 → 存储的资产管理器里，现在画布节点右键也要用，抽出来共用。
 * 浏览器（`npm run dev`）没有文件存储，直接返回 false，调用方据此不显示入口。
 *
 * @returns 是否真的落盘（用户取消保存对话框也返回 false）
 */
export async function saveMediaAs(rel: string): Promise<boolean> {
  if (!rel || !isTauriRuntime()) return false;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const dest = await save({ defaultPath: rel.split('/').pop() });
  if (!dest) return false;
  await mediaExport(rel, dest);
  return true;
}
