import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

import {
  AI_CONFIG_MIGRATED_BACKUP_KEY,
  AI_CONFIG_STORAGE_KEY,
  __resetAiConfigStoreForTests,
  getAiConfigDegradedReason,
  loadAiConfig,
  saveAiConfig,
  subscribeAiConfigDegraded,
} from '../../src/services/aiConfigStore';

const V2_JSON = JSON.stringify({ version: 2, providers: [{ apiKey: 'sk-live' }] });
const LEGACY_JSON = JSON.stringify({ provider: 'doubao', apiKey: 'ark-old', model: 'ep-1' });

describe('aiConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAiConfigStoreForTests();
    isTauriRuntime.mockReturnValue(true);
  });

  // ── 迁移状态机 ──

  it('首启迁移：keystore 为空时把 localStorage 旧值写进去，先复制后切换', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'keystore_load' ? null : undefined,
    );
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, LEGACY_JSON);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: LEGACY_JSON, degraded: null });
    expect(invoke).toHaveBeenCalledWith('keystore_save', { payload: LEGACY_JSON });
    // 旧键改名为备份，保留一个版本周期，不直接删
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY)).toBe(LEGACY_JSON);
  });

  it('迁移写失败：旧键原样保留（下次启动重试），本次降级用 localStorage 的值', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'keystore_load') return null;
      throw new Error('io error');
    });
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, LEGACY_JSON);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: LEGACY_JSON, degraded: 'unavailable' });
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBe(LEGACY_JSON);
    expect(localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY)).toBeNull();
    expect(getAiConfigDegradedReason()).toBe('unavailable');
  });

  it('keystore 为空但只剩备份键（密钥文件丢失）时，用备份重迁而不是丢配置', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'keystore_load' ? null : undefined,
    );
    localStorage.setItem(AI_CONFIG_MIGRATED_BACKUP_KEY, V2_JSON);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: V2_JSON, degraded: null });
    expect(invoke).toHaveBeenCalledWith('keystore_save', { payload: V2_JSON });
    // 备份键保持原状：它本来就是备份
    expect(localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY)).toBe(V2_JSON);
  });

  it('两边都空时是真·首启：返回 null 且不触发任何写入', async () => {
    invoke.mockResolvedValue(null);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: null, degraded: null });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('keystore_load');
  });

  // ── 二次启动 ──

  it('二次启动直读 keystore，不再碰 localStorage 里的备份', async () => {
    invoke.mockResolvedValue(V2_JSON);
    localStorage.setItem(AI_CONFIG_MIGRATED_BACKUP_KEY, LEGACY_JSON);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: V2_JSON, degraded: null });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY)).toBe(LEGACY_JSON);
  });

  // ── corrupt 回退 ──

  it('keystore_corrupt：回退读备份、亮 degraded，且后续保存不再去覆盖坏文件', async () => {
    invoke.mockRejectedValue('keystore_corrupt');
    localStorage.setItem(AI_CONFIG_MIGRATED_BACKUP_KEY, LEGACY_JSON);

    const loaded = await loadAiConfig();
    expect(loaded).toEqual({ raw: LEGACY_JSON, degraded: 'corrupt' });
    expect(getAiConfigDegradedReason()).toBe('corrupt');

    invoke.mockClear();
    const saved = await saveAiConfig({ version: 2, providers: [] });
    expect(saved).toEqual({ degraded: true });
    // 坏文件一次都没被写过
    expect(invoke).not.toHaveBeenCalledWith('keystore_save', expect.anything());
    // 新配置降级落在 localStorage
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 2, providers: [] }),
    );
  });

  it('corrupt 但 localStorage 也一无所有：raw 为 null，警示照亮', async () => {
    invoke.mockRejectedValue(new Error('keystore_corrupt'));

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: null, degraded: 'corrupt' });
  });

  it('非 corrupt 的读失败（IO）按 unavailable 处理，保存时仍会先试密钥库', async () => {
    invoke.mockRejectedValueOnce(new Error('permission denied'));
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, LEGACY_JSON);

    const loaded = await loadAiConfig();
    expect(loaded).toEqual({ raw: LEGACY_JSON, degraded: 'unavailable' });

    // 密钥库恢复了：保存成功并清掉降级标志
    invoke.mockResolvedValue(undefined);
    const saved = await saveAiConfig({ version: 2, providers: [] });
    expect(saved).toEqual({ degraded: false });
    expect(invoke).toHaveBeenCalledWith('keystore_save', {
      payload: JSON.stringify({ version: 2, providers: [] }),
    });
    expect(getAiConfigDegradedReason()).toBeNull();
  });

  // ── 保存 ──

  it('保存成功后，localStorage 主键上残留的降级明文挪进备份键', async () => {
    invoke.mockResolvedValue(undefined);
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, LEGACY_JSON);

    await saveAiConfig({ version: 2, providers: [] });

    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY)).toBe(LEGACY_JSON);
  });

  it('保存失败降级写 localStorage，返回 degraded 并通知订阅者', async () => {
    invoke.mockRejectedValue(new Error('disk full'));
    const onChange = vi.fn();
    subscribeAiConfigDegraded(onChange);

    const saved = await saveAiConfig({ version: 2, providers: [] });

    expect(saved).toEqual({ degraded: true });
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 2, providers: [] }),
    );
    expect(getAiConfigDegradedReason()).toBe('unavailable');
    expect(onChange).toHaveBeenCalled();
  });

  // ── 非 Tauri 直通 ──

  it('浏览器调试模式：load 直读 localStorage，不碰 invoke，也不迁移', async () => {
    isTauriRuntime.mockReturnValue(false);
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, V2_JSON);

    const result = await loadAiConfig();

    expect(result).toEqual({ raw: V2_JSON, degraded: null });
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBe(V2_JSON);
  });

  it('浏览器调试模式：save 直写 localStorage', async () => {
    isTauriRuntime.mockReturnValue(false);

    const saved = await saveAiConfig({ version: 2, providers: [] });

    expect(saved).toEqual({ degraded: false });
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 2, providers: [] }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
