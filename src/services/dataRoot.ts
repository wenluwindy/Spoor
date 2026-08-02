import { isTauriRuntime } from '../utils/isTauriRuntime';
import { AppError } from './appError';

/**
 * 数据目录迁移的前端门面，对应 Rust 的 `data_root_*` 命令
 * （见 `src-tauri/src/dataroot.rs`）。
 *
 * 迁移是**复制**而不是移动：Rust 侧把 `SpoorData/` 整棵复制到新位置、校验
 * 总数与字节数后写配置切换，旧目录原样保留，等用户确认新位置没问题后自己删。
 */

export interface DataRootMigrateProgress {
  /** 已复制的文件数。 */
  copied: number;
  /** 总文件数。 */
  total: number;
  bytesCopied: number;
  bytesTotal: number;
}

/** 当前生效的数据根绝对路径。 */
export async function dataRootGet(): Promise<string> {
  if (!isTauriRuntime()) throw new AppError('media.desktop_only', 'data_root_get');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('data_root_get');
}

/**
 * 把数据根复制到 `newParent/SpoorData/` 并切换过去，返回新数据根。
 *
 * `newParent` 必须来自本进程刚弹过的目录对话框（`pickDirectory()`）——
 * Rust 侧按 userfile 的写入白名单校验，别的路径一律 `path_not_authorized`。
 * 进度经 `data-root-migrate-progress` 事件推上来，模式同更新下载。
 */
export async function dataRootMigrate(
  newParent: string,
  onProgress?: (progress: DataRootMigrateProgress) => void,
): Promise<string> {
  if (!isTauriRuntime()) throw new AppError('media.desktop_only', 'data_root_migrate');
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);

  const unlisten = onProgress
    ? await listen<DataRootMigrateProgress>('data-root-migrate-progress', ({ payload }) =>
        onProgress(payload),
      )
    : null;
  try {
    return await invoke<string>('data_root_migrate', { newParent });
  } finally {
    unlisten?.();
  }
}
