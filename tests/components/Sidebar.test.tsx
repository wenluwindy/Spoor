import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../../src/components/Sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

const defaultProps = () => ({
  isSidebarOpen: true,
  setIsSidebarOpen: vi.fn(),
  activeTab: 'personal',
  setActiveTab: vi.fn(),
  userAvatar: '/LOGO.png',
  setUserAvatar: vi.fn(),
  userName: '策展人',
  setUserName: vi.fn(),
  userRole: '写作中',
  setUserRole: vi.fn(),
  setIsSettingsOpen: vi.fn(),
});

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('底部按钮：展开后要有文字', () => {
    it('展开时收起侧栏与设置都显示文案', () => {
      render(<Sidebar {...defaultProps()} />);
      expect(screen.getByText('sidebar.collapse')).toBeInTheDocument();
      expect(screen.getByText('sidebar.settings')).toBeInTheDocument();
    });

    it('文案与导航项一样是按钮的可见内容，不只是 aria-label', () => {
      render(<Sidebar {...defaultProps()} />);
      const settingsBtn = screen.getByRole('button', { name: 'sidebar.settings' });
      expect(settingsBtn).toHaveTextContent('sidebar.settings');
      const toggleBtn = screen.getByRole('button', { name: 'sidebar.collapse' });
      expect(toggleBtn).toHaveTextContent('sidebar.collapse');
    });

    it('收起时不显示文案，但仍可按 aria-label 找到按钮', () => {
      render(<Sidebar {...defaultProps()} isSidebarOpen={false} />);
      expect(screen.queryByText('sidebar.expand')).toBeNull();
      expect(screen.queryByText('sidebar.settings')).toBeNull();
      expect(screen.getByRole('button', { name: 'sidebar.expand' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sidebar.settings' })).toBeInTheDocument();
    });

    it('展开态显示「收起」，收起态显示「展开」', () => {
      const { unmount } = render(<Sidebar {...defaultProps()} />);
      expect(screen.getByText('sidebar.collapse')).toBeInTheDocument();
      expect(screen.queryByText('sidebar.expand')).toBeNull();
      unmount();

      render(<Sidebar {...defaultProps()} isSidebarOpen={false} />);
      expect(screen.getByRole('button', { name: 'sidebar.expand' })).toBeInTheDocument();
    });

    it('不再用原生 title（提示统一走 Tooltip 组件）', () => {
      const { container } = render(<Sidebar {...defaultProps()} isSidebarOpen={false} />);
      expect(container.querySelectorAll('button[title]').length).toBe(0);
    });

    it('点击后仍能切换侧栏与打开设置', async () => {
      const user = userEvent.setup();
      const props = defaultProps();
      render(<Sidebar {...props} />);

      await user.click(screen.getByRole('button', { name: 'sidebar.collapse' }));
      expect(props.setIsSidebarOpen).toHaveBeenCalledWith(false);

      await user.click(screen.getByRole('button', { name: 'sidebar.settings' }));
      expect(props.setIsSettingsOpen).toHaveBeenCalledWith(true);
    });
  });
});
