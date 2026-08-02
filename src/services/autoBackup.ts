/**
 * 自动快照：每天在数据根的 `backups/` 里留一份备份，滚动保留最近七份。
 *
 * 存在的理由是「误删了才想起没备份」这件事一定会发生。手动导出要人记得点，自动快照
 * 不需要——启动时看一眼上次是什么时候，隔了一天就顺手写一份。
 *
 * 快照与手动导出是**同一种文件**（见 `services/backup`），因此同样不含密钥、不含媒体
 * 原件，也同样能被「从备份还原」读回去。裁剪与文件名校验在 Rust 侧
 * （`src-tauri/src/snapshot.rs`）。
 */

import { isTauriRuntime } from '../utils/isTauriRuntime';
import { backupFileName, buildBackup, parseBackup, serializeBackup, type SpoorBackup } from './backup';
import { logger } from '../utils/logger';

export const LAST_SNAPSHOT_AT_KEY = 'last_snapshot_at';

/** 两次自动快照之间至少隔这么久。 */
export const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SnapshotEntry {
  name: string;
  bytes: number;
  /** Unix 毫秒。 */
  mtime: number;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/**
 * 该不该写了。
 *
 * 时间倒流（改系统时钟、换时区）时也写一份：宁可多留一份，也不要因为
 * `now < lastAt` 这种情况永远不再快照。
 */
export function shouldWriteSnapshot(lastAt: number | null, now: number): boolean {
  if (lastAt === null || !Number.isFinite(lastAt)) return true;
  const elapsed = now - lastAt;
  return elapsed >= SNAPSHOT_INTERVAL_MS || elapsed < 0;
}

/**
 * 启动时调一次。写了返回文件名，跳过或失败返回 null。
 *
 * 失败一律吞掉：快照是后台的好意，不该在启动路径上弹错误框打断人。
 */
export async function runDailySnapshot(appVersion: string, now: number): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  const raw = localStorage.getItem(LAST_SNAPSHOT_AT_KEY);
  const lastAt = raw === null ? null : Number(raw);
  if (!shouldWriteSnapshot(lastAt, now)) return null;

  try {
    const backup = await buildBackup(appVersion, now);
    const name = await call<string>('snapshot_write', {
      name: backupFileName(new Date(now)),
      contents: serializeBackup(backup),
    });
    localStorage.setItem(LAST_SNAPSHOT_AT_KEY, String(now));
    return name;
  } catch (e) {
    logger.warn('backup', '自动快照失败', e);
    return null;
  }
}

export async function listSnapshots(): Promise<SnapshotEntry[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await call<SnapshotEntry[]>('snapshot_list');
  } catch {
    return [];
  }
}

/** 读回一份快照。文件不在或内容不是备份时返回 null。 */
export async function readSnapshot(name: string): Promise<SpoorBackup | null> {
  if (!isTauriRuntime()) return null;
  try {
    return parseBackup(await call<string>('snapshot_read', { name }));
  } catch {
    return null;
  }
}
