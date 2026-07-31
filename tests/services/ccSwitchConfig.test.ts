import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCcSwitchConfig } from '../../src/services/ccSwitchConfig';

const invoke = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

describe('readCcSwitchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it('从桌面命令读取默认数据库', async () => {
    const config = { providers: [{ name: 'Relay', settingsConfig: {} }] };
    invoke.mockResolvedValue({ status: 'found', config });

    await expect(readCcSwitchConfig()).resolves.toEqual({
      status: 'found',
      config,
    });
    expect(invoke).toHaveBeenCalledWith('cc_switch_read_config');
  });

  it('网页调试环境不尝试读取本机文件', async () => {
    isTauriRuntime.mockReturnValue(false);

    await expect(readCcSwitchConfig()).resolves.toEqual({ status: 'not_installed' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('桌面命令异常时返回读取失败', async () => {
    invoke.mockRejectedValue(new Error('permission denied'));

    await expect(readCcSwitchConfig()).resolves.toMatchObject({ status: 'read_failed' });
  });
});
