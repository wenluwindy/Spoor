import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { StorageSettingsTab } from '../../src/components/settings/StorageSettingsTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
    i18n: { language: 'zh' },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

const mediaStoreInfo = vi.hoisted(() => vi.fn());
const mediaOpenRoot = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/mediaStore', () => ({ mediaStoreInfo, mediaOpenRoot }));

const dataRootMigrate = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/dataRoot', () => ({ dataRootMigrate }));

const pickDirectory = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/userTextFile', () => ({ pickDirectory }));

// 备份卡与资产管理器各有自己的测试，这里只关心数据目录区块
vi.mock('../../src/components/settings/BackupCard', () => ({ BackupCard: () => null }));
vi.mock('../../src/components/settings/MediaAssetManager', () => ({
  MediaAssetManager: () => null,
}));

const info = (root = 'D:\\Apps\\Spoor\\SpoorData') => ({
  root,
  bytes: 12,
  count: 3,
  fallback: false,
  custom: false,
});

describe('StorageSettingsTab · 数据目录迁移', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
    mediaStoreInfo.mockResolvedValue(info());
  });

  it('显示当前数据根路径与「更改位置」按钮', async () => {
    render(<StorageSettingsTab />);
    expect(await screen.findByText('D:\\Apps\\Spoor\\SpoorData')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /settings\.storage_change_location/ }),
    ).toBeInTheDocument();
  });

  it('选好目录后触发迁移，成功刷新路径并提示旧目录仍保留', async () => {
    pickDirectory.mockResolvedValue('E:\\Data');
    dataRootMigrate.mockResolvedValue('E:\\Data\\SpoorData');
    render(<StorageSettingsTab />);
    await screen.findByText('D:\\Apps\\Spoor\\SpoorData');
    mediaStoreInfo.mockResolvedValue(info('E:\\Data\\SpoorData'));

    await userEvent.click(
      screen.getByRole('button', { name: /settings\.storage_change_location/ }),
    );

    await waitFor(() =>
      expect(dataRootMigrate).toHaveBeenCalledWith('E:\\Data', expect.any(Function)),
    );
    expect(await screen.findByText('E:\\Data\\SpoorData')).toBeInTheDocument();
    // 旧目录不删，界面上要一直提示它在哪
    expect(
      screen.getByText(/storage_migrate_old_kept.*D:\\\\Apps\\\\Spoor\\\\SpoorData/),
    ).toBeInTheDocument();
  });

  it('在目录对话框里取消则什么都不发生', async () => {
    pickDirectory.mockResolvedValue(null);
    render(<StorageSettingsTab />);
    await screen.findByText('D:\\Apps\\Spoor\\SpoorData');

    await userEvent.click(
      screen.getByRole('button', { name: /settings\.storage_change_location/ }),
    );

    expect(dataRootMigrate).not.toHaveBeenCalled();
  });

  it('目标已有 SpoorData 时给专门的提示，路径不变', async () => {
    pickDirectory.mockResolvedValue('E:\\Data');
    dataRootMigrate.mockRejectedValue('target_exists');
    render(<StorageSettingsTab />);
    await screen.findByText('D:\\Apps\\Spoor\\SpoorData');

    await userEvent.click(
      screen.getByRole('button', { name: /settings\.storage_change_location/ }),
    );

    expect(
      await screen.findByText('settings.storage_migrate_target_exists'),
    ).toBeInTheDocument();
    // 配置没动，显示的还是旧根
    expect(screen.getByText('D:\\Apps\\Spoor\\SpoorData')).toBeInTheDocument();
  });

  it('其他失败展示原因，且不留下「旧目录仍保留」的成功提示', async () => {
    pickDirectory.mockResolvedValue('E:\\Data');
    dataRootMigrate.mockRejectedValue('disk_write_failed: os error 112');
    render(<StorageSettingsTab />);
    await screen.findByText('D:\\Apps\\Spoor\\SpoorData');

    await userEvent.click(
      screen.getByRole('button', { name: /settings\.storage_change_location/ }),
    );

    expect(
      await screen.findByText(/storage_migrate_failed.*disk_write_failed/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/storage_migrate_old_kept/)).toBeNull();
  });
});
