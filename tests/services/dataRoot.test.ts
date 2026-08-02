import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataRootGet, dataRootMigrate } from '../../src/services/dataRoot';
import { isAppError } from '../../src/services/appError';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

describe('dataRootGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it('透传 Rust 命令的结果', async () => {
    invoke.mockResolvedValue('D:\\Apps\\Spoor\\SpoorData');
    await expect(dataRootGet()).resolves.toBe('D:\\Apps\\Spoor\\SpoorData');
    expect(invoke).toHaveBeenCalledWith('data_root_get');
  });

  it('浏览器环境直接拒绝（media.desktop_only）', async () => {
    isTauriRuntime.mockReturnValue(false);
    await expect(dataRootGet()).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === 'media.desktop_only',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('dataRootMigrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it('调用命令并把进度事件转给回调，结束后取消监听', async () => {
    const unlisten = vi.fn();
    let handler: ((e: { payload: unknown }) => void) | undefined;
    listen.mockImplementation((_event: string, cb: (e: { payload: unknown }) => void) => {
      handler = cb;
      return Promise.resolve(unlisten);
    });
    invoke.mockImplementation(async () => {
      // 模拟 Rust 复制期间发进度
      handler?.({ payload: { copied: 2, total: 4, bytesCopied: 10, bytesTotal: 20 } });
      return 'E:\\Data\\SpoorData';
    });

    const onProgress = vi.fn();
    await expect(dataRootMigrate('E:\\Data', onProgress)).resolves.toBe('E:\\Data\\SpoorData');

    expect(listen).toHaveBeenCalledWith('data-root-migrate-progress', expect.any(Function));
    expect(invoke).toHaveBeenCalledWith('data_root_migrate', { newParent: 'E:\\Data' });
    expect(onProgress).toHaveBeenCalledWith({
      copied: 2,
      total: 4,
      bytesCopied: 10,
      bytesTotal: 20,
    });
    expect(unlisten).toHaveBeenCalled();
  });

  it('不传回调时不订阅事件', async () => {
    invoke.mockResolvedValue('E:\\Data\\SpoorData');
    await dataRootMigrate('E:\\Data');
    expect(listen).not.toHaveBeenCalled();
  });

  it('命令失败原样抛出（target_exists 等错误码要留给 UI 认），且仍取消监听', async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockRejectedValue('target_exists');

    await expect(dataRootMigrate('E:\\Data', vi.fn())).rejects.toBe('target_exists');
    expect(unlisten).toHaveBeenCalled();
  });
});
