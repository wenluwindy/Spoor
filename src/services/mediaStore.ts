import { isTauriRuntime } from '../utils/isTauriRuntime';
import { AppError } from './appError';

/**
 * 本地媒体存储的前端门面，一一对应 Rust 的 `media_*` 命令
 * （见 `src-tauri/src/media.rs`）。
 *
 * 这里**只传路径与元数据**，大二进制始终留在 Rust 侧：导入是 `fs::copy`，
 * 显示是 `spoor-media` 协议直接读盘。`media_import_bytes` 是唯一的例外，
 * 留给本来就没有源路径的场景（剪贴板、旧 base64 迁移）。
 */

export interface MediaStoreInfo {
  /** 数据根绝对路径，只用于设置里显示与「打开文件夹」，不要写进数据库。 */
  root: string;
  bytes: number;
  count: number;
  /** 安装目录不可写、已回退到应用数据目录。 */
  fallback: boolean;
}

export interface MediaEntry {
  rel: string;
  bytes: number;
  /** Unix 毫秒。 */
  mtime: number;
  ext: string;
}

export interface MediaImportResult {
  rel: string;
  bytes: number;
  ext: string;
  fileName: string;
}

export interface MediaGcResult {
  removed: number;
  bytes: number;
}

/** 与 Rust 侧 `sanitize_category` 的白名单一致。 */
export type MediaCategory = 'generated' | 'uploaded' | 'documents';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    // 网页版已废弃，这条路径只可能出现在 `npm run dev` 的浏览器调试里
    throw new AppError('media.desktop_only', command);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new AppError('media.command_failed', `${command}: ${String(e)}`);
  }
}

export function mediaStoreInfo(): Promise<MediaStoreInfo> {
  return call<MediaStoreInfo>('media_store_info');
}

export function mediaList(category?: MediaCategory): Promise<MediaEntry[]> {
  return call<MediaEntry[]>('media_list', { category: category ?? null });
}

/** 从原生绝对路径复制入库。500MB 的视频也不过 IPC。 */
export function mediaImport(
  srcPath: string,
  category: MediaCategory,
): Promise<MediaImportResult> {
  return call<MediaImportResult>('media_import', { srcPath, category });
}

/** 字节流入库。只给剪贴板 / 旧 base64 迁移用——有路径就走 `mediaImport`。 */
export function mediaImportBytes(
  bytes: Uint8Array | number[],
  ext: string,
  category: MediaCategory,
  fileName?: string,
): Promise<MediaImportResult> {
  return call<MediaImportResult>('media_import_bytes', {
    bytes: Array.from(bytes),
    ext,
    category,
    fileName: fileName ?? null,
  });
}

export function mediaExport(rel: string, destPath: string): Promise<void> {
  return call<void>('media_export', { rel, destPath });
}

/** 返回真正删掉的条数：越权或已不存在的会被静默跳过。 */
export function mediaDelete(rels: string[]): Promise<number> {
  return call<number>('media_delete', { rels });
}

export function mediaReveal(rel: string): Promise<void> {
  return call<void>('media_reveal', { rel });
}

export function mediaOpenRoot(): Promise<void> {
  return call<void>('media_open_root');
}

/**
 * 删除不在 `referenced` 里的文件。
 *
 * 只在用户从资产管理器显式触发时调用。引用关系只有前端（IndexedDB）知道，
 * 传漏了就是永久丢图，所以不做任何自动清理。
 */
export function mediaGc(referenced: string[]): Promise<MediaGcResult> {
  return call<MediaGcResult>('media_gc', { referenced });
}
