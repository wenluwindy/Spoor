import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { UpdateCard } from '../../src/components/settings/UpdateCard';
import { resetUpdateState } from '../../src/services/appUpdate';

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

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

const UP_TO_DATE = {
  available: false,
  currentVersion: '0.2.0',
  latestVersion: '',
  notes: '',
  assetName: '',
  assetSize: 0,
  downloadUrl: '',
  releaseUrl: '',
};

const AVAILABLE = {
  ...UP_TO_DATE,
  available: true,
  latestVersion: '0.3.0',
  notes: '修好了生图',
  assetName: 'Spoor_0.3.0_x64-setup.exe',
  assetSize: 5_242_880,
  downloadUrl: 'https://github.com/wenluwindy/Spoor/releases/download/v0.3.0/x.exe',
  releaseUrl: 'https://github.com/wenluwindy/Spoor/releases/tag/v0.3.0',
};

describe('UpdateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
    resetUpdateState();
  });

  afterEach(() => resetUpdateState());

  it('初始只给一个「检查更新」按钮', () => {
    render(<UpdateCard />);
    expect(screen.getByRole('button', { name: /settings\.update_check/ })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('已是最新时报当前版本，不出现下载按钮', async () => {
    invoke.mockResolvedValue(UP_TO_DATE);
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));

    expect(screen.getByText('settings.update_up_to_date')).toBeInTheDocument();
    expect(screen.getByText(/settings\.update_current_version.*0\.2\.0/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update_download/ })).not.toBeInTheDocument();
  });

  it('仓库还没发过版（Rust 报 available:false）也走「已是最新」，不报错', async () => {
    // GitHub 对没有 release 的仓库返回 404，Rust 侧已归一成这个形状
    invoke.mockResolvedValue({ ...UP_TO_DATE, currentVersion: '0.2.0' });
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));

    expect(screen.getByText('settings.update_up_to_date')).toBeInTheDocument();
    expect(screen.queryByText('settings.update_failed')).not.toBeInTheDocument();
  });

  it('发现新版本时列出版本号、体积与更新说明', async () => {
    invoke.mockResolvedValue(AVAILABLE);
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));

    expect(screen.getByText(/settings\.update_available.*0\.3\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Spoor_0\.3\.0_x64-setup\.exe · 5\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText('修好了生图')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update_download/ })).toBeInTheDocument();
  });

  it('下载完成后按钮变成「立即安装」，并提醒会先关掉应用', async () => {
    invoke.mockResolvedValueOnce(AVAILABLE).mockResolvedValueOnce('C:/tmp/spoor-update/x.exe');
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));
    await userEvent.click(screen.getByRole('button', { name: /update_download/ }));

    expect(screen.getByRole('button', { name: /update_install/ })).toBeInTheDocument();
    expect(screen.getByText('settings.update_install_hint')).toBeInTheDocument();
  });

  it('点安装把下载下来的路径交给 Rust', async () => {
    invoke.mockResolvedValueOnce(AVAILABLE).mockResolvedValueOnce('C:/tmp/spoor-update/x.exe');
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));
    await userEvent.click(screen.getByRole('button', { name: /update_download/ }));
    await userEvent.click(screen.getByRole('button', { name: /update_install/ }));

    expect(invoke).toHaveBeenLastCalledWith('install_update', {
      path: 'C:/tmp/spoor-update/x.exe',
    });
  });

  it('手动检查失败时如实报错并带出原因', async () => {
    invoke.mockRejectedValue(new Error('HTTP 403'));
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));

    expect(screen.getByText('settings.update_failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 403')).toBeInTheDocument();
  });

  it('非桌面环境直接说已是最新，不去碰 invoke', async () => {
    isTauriRuntime.mockReturnValue(false);
    render(<UpdateCard />);

    await userEvent.click(screen.getByRole('button', { name: /settings\.update_check/ }));

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText('settings.update_up_to_date')).toBeInTheDocument();
  });
});
