import { describe, it, expect, vi, beforeEach } from 'vitest';

const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
const invoke = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const {
  LAST_SNAPSHOT_AT_KEY,
  SNAPSHOT_INTERVAL_MS,
  listSnapshots,
  readSnapshot,
  runDailySnapshot,
  shouldWriteSnapshot,
} = await import('../../src/services/autoBackup');

const NOW = 1_754_000_000_000;

describe('autoBackup', () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    isTauriRuntime.mockReturnValue(true);
  });

  describe('该不该写', () => {
    it('从没写过就写', () => {
      expect(shouldWriteSnapshot(null, NOW)).toBe(true);
    });

    it('隔了一天就写，不到一天不写', () => {
      expect(shouldWriteSnapshot(NOW - SNAPSHOT_INTERVAL_MS, NOW)).toBe(true);
      expect(shouldWriteSnapshot(NOW - SNAPSHOT_INTERVAL_MS + 1000, NOW)).toBe(false);
    });

    it('时钟倒流时也写——否则改过系统时间后就再也不快照了', () => {
      expect(shouldWriteSnapshot(NOW + 999_999, NOW)).toBe(true);
    });

    it('存坏的时间戳当作从没写过', () => {
      expect(shouldWriteSnapshot(Number.NaN, NOW)).toBe(true);
    });
  });

  describe('每日快照', () => {
    it('写一份并记下时间', async () => {
      invoke.mockResolvedValue('spoor-backup-2026-08-01.json');

      const name = await runDailySnapshot('0.3.0', NOW);

      expect(name).toBe('spoor-backup-2026-08-01.json');
      expect(invoke).toHaveBeenCalledWith(
        'snapshot_write',
        expect.objectContaining({ name: expect.stringMatching(/^spoor-backup-\d{4}-\d{2}-\d{2}\.json$/) }),
      );
      expect(localStorage.getItem(LAST_SNAPSHOT_AT_KEY)).toBe(String(NOW));
    });

    it('同一天再启动不重复写', async () => {
      localStorage.setItem(LAST_SNAPSHOT_AT_KEY, String(NOW - 1000));
      expect(await runDailySnapshot('0.3.0', NOW)).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('浏览器调试时直接跳过（没有数据根可写）', async () => {
      isTauriRuntime.mockReturnValue(false);
      expect(await runDailySnapshot('0.3.0', NOW)).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('写失败只记日志，不抛给启动路径，也不推进时间戳', async () => {
      invoke.mockRejectedValue(new Error('disk_write_failed'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(await runDailySnapshot('0.3.0', NOW)).toBeNull();
      expect(localStorage.getItem(LAST_SNAPSHOT_AT_KEY)).toBeNull();

      warn.mockRestore();
    });
  });

  describe('列出与读回', () => {
    it('列出快照', async () => {
      invoke.mockResolvedValue([{ name: 'a.json', bytes: 10, mtime: 1 }]);
      expect(await listSnapshots()).toHaveLength(1);
    });

    it('读不到时返回空数组 / null，而不是炸掉设置页', async () => {
      invoke.mockRejectedValue(new Error('nope'));
      expect(await listSnapshots()).toEqual([]);
      expect(await readSnapshot('a.json')).toBeNull();
    });

    it('内容不是备份时返回 null', async () => {
      invoke.mockResolvedValue('这不是备份');
      expect(await readSnapshot('a.json')).toBeNull();
    });

    it('内容是备份时解析出来', async () => {
      invoke.mockResolvedValue(
        JSON.stringify({ format: 'spoor-backup', version: 1, createdAt: NOW, tables: {} }),
      );
      expect((await readSnapshot('a.json'))?.createdAt).toBe(NOW);
    });
  });
});
