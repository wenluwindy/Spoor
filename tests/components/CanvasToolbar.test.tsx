import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasToolbar } from '../../src/components/CanvasToolbar';
import {
  CANVAS_ALL_FILE_ACCEPT,
  CANVAS_CREATE_ITEMS,
} from '../../src/constants/canvasMenuItems';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: { nodes: { add: vi.fn() } },
}));

vi.mock('../../src/utils/aiI18n', () => ({
  resolveAgentLocalizedName: (a: { name: string }) => a.name,
}));

vi.mock('../../src/utils/canvas', () => ({
  getCanvasCenterPosition: () => ({ x: 0, y: 0 }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

const defaultProps = () => ({
  isToolbarAiLoading: false,
  isInputDisabled: false,
  aiPrompt: '',
  setAiPrompt: vi.fn(),
  handleAiSubmit: vi.fn(),
  onCreateNode: vi.fn(),
  onZoomToFit: vi.fn(),
  addFileNode: vi.fn(),
  agentConfigs: [],
  canvasTransform: { x: 0, y: 0, scale: 1 },
  setCanvasTransform: vi.fn(),
  transformRef: { current: { x: 0, y: 0, scale: 1 } },
  activeCanvasId: 'default',
  intentClarification: null,
  isIntentSubmitting: false,
  onCancelIntentClarification: vi.fn(),
  onConfirmIntentClarification: vi.fn(),
});

describe('CanvasToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('提交按钮使用 Wand2，不使用 Send（纸飞机）', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.getByTestId('icon-Wand2')).toBeInTheDocument();
    const sendIcons = container.querySelectorAll('[data-testid="icon-Send"]');
    expect(sendIcons.length).toBe(0);
  });

  it('输入框左侧不再单独显示装饰性 Wand2', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    const wandIcons = container.querySelectorAll('[data-testid="icon-Wand2"]');
    expect(wandIcons.length).toBe(1);
  });

  it('加载中时提交按钮显示 Loader2', () => {
    render(<CanvasToolbar {...defaultProps()} isToolbarAiLoading />);
    expect(screen.getByTestId('icon-Loader2')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-Wand2')).toBeNull();
  });

  it('Enter 与点击提交按钮均调用 handleAiSubmit', async () => {
    const user = userEvent.setup();
    const handleAiSubmit = vi.fn();
    const setAiPrompt = vi.fn();

    render(
      <CanvasToolbar
        {...defaultProps()}
        aiPrompt="写一段引言"
        setAiPrompt={setAiPrompt}
        handleAiSubmit={handleAiSubmit}
      />
    );

    const input = screen.getByPlaceholderText('ai.input_placeholder');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleAiSubmit).toHaveBeenCalledTimes(1);

    const submitBtn = screen.getByTestId('icon-Wand2').closest('button');
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);
    expect(handleAiSubmit).toHaveBeenCalledTimes(2);
  });

  it('禁用时输入框为 disabled（不可编辑）', () => {
    render(<CanvasToolbar {...defaultProps()} isInputDisabled />);
    expect(screen.getByPlaceholderText('ai.input_placeholder')).toBeDisabled();
  });

  describe('+ 菜单与右键菜单同源', () => {
    it('逐项渲染 CANVAS_CREATE_ITEMS 的文案', () => {
      render(<CanvasToolbar {...defaultProps()} />);
      for (const item of CANVAS_CREATE_ITEMS) {
        expect(screen.getAllByText(item.labelKey).length).toBeGreaterThan(0);
      }
    });

    it('每项按自己的 nodeType 调用 onCreateNode', async () => {
      const user = userEvent.setup();
      const onCreateNode = vi.fn();
      render(<CanvasToolbar {...defaultProps()} onCreateNode={onCreateNode} />);

      for (const item of CANVAS_CREATE_ITEMS) {
        const entry = screen.getAllByText(item.labelKey).at(-1)!.closest('button')!;
        await user.click(entry);
        expect(onCreateNode).toHaveBeenLastCalledWith(item.nodeType);
      }
      expect(onCreateNode).toHaveBeenCalledTimes(CANVAS_CREATE_ITEMS.length);
    });

    it('+ 图标本身触发列表首项', async () => {
      const user = userEvent.setup();
      const onCreateNode = vi.fn();
      const { container } = render(<CanvasToolbar {...defaultProps()} onCreateNode={onCreateNode} />);

      const plusButton = container.querySelector('button[aria-label="sidebar.new_note"]')!;
      await user.click(plusButton);
      expect(onCreateNode).toHaveBeenCalledWith(CANVAS_CREATE_ITEMS[0].nodeType);
    });

    it('上传输入框的 accept 用统一常量', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      expect(container.querySelector('input[type="file"]')).toHaveAttribute(
        'accept',
        CANVAS_ALL_FILE_ACCEPT,
      );
    });

    it('右下角有「缩放至适应全部内容」按钮并回调', async () => {
      const user = userEvent.setup();
      const onZoomToFit = vi.fn();
      render(<CanvasToolbar {...defaultProps()} onZoomToFit={onZoomToFit} />);

      const btn = screen.getByRole('button', { name: 'canvas.zoom_to_fit' });
      await user.click(btn);
      expect(onZoomToFit).toHaveBeenCalledTimes(1);
    });

    it('上传按钮的提示已汉化（不再是硬编码 Upload File）', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      expect(container.querySelector('label[aria-label="canvas.upload_file"]')).toBeTruthy();
      expect(container.querySelector('label[aria-label="Upload File"]')).toBeNull();
    });
  });
});
