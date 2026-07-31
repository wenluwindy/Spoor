import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopOnlyNotice } from '../../src/components/DesktopOnlyNotice';
import { DESKTOP_RELEASE_URL } from '../../src/constants/desktopRelease';

const changeLanguage = vi.fn();
let language = 'zh';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return language;
      },
      changeLanguage,
    },
  }),
}));

const openExternalUrl = vi.fn();
vi.mock('../../src/utils/openExternal', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

vi.mock('../../src/assets/LOGO.png', () => ({ default: 'logo.png' }));

describe('DesktopOnlyNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    language = 'zh';
    localStorage.clear();
  });

  it('显示标题、说明与下载按钮', () => {
    render(<DesktopOnlyNotice />);
    expect(screen.getByText('desktop_only.title')).toBeInTheDocument();
    expect(screen.getByText('desktop_only.blurb')).toBeInTheDocument();
    expect(screen.getByText('desktop_only.download')).toBeInTheDocument();
  });

  it('点击下载走系统浏览器打开 Releases', async () => {
    const user = userEvent.setup();
    render(<DesktopOnlyNotice />);

    await user.click(screen.getByText('desktop_only.download').closest('button')!);
    expect(openExternalUrl).toHaveBeenCalledWith(DESKTOP_RELEASE_URL);
  });

  it('可切换语言并记住选择', async () => {
    const user = userEvent.setup();
    render(<DesktopOnlyNotice />);

    await user.click(screen.getByText('English'));
    expect(changeLanguage).toHaveBeenCalledWith('en');
    expect(localStorage.getItem('app_language')).toBe('en');
  });

  it('英文界面下切回中文', async () => {
    language = 'en';
    const user = userEvent.setup();
    render(<DesktopOnlyNotice />);

    await user.click(screen.getByText('中文'));
    expect(changeLanguage).toHaveBeenCalledWith('zh');
  });
});
