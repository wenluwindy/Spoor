import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasToolbar } from '../../src/components/CanvasToolbar';
import {
  TOOLBAR_ATTACHMENT_ACCEPT,
  type ToolbarAttachment,
} from '../../src/constants/toolbarAttachments';

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
  isToolbarAiLoading: false,
  isInputDisabled: false,
  aiPrompt: '',
  setAiPrompt: vi.fn(),
  handleAiSubmit: vi.fn(),
  onZoomToFit: vi.fn(),
  canvasTransform: { x: 0, y: 0, scale: 1 },
  setCanvasTransform: vi.fn(),
  attachments: [] as ToolbarAttachment[],
  onAddAttachments: vi.fn(),
  onRemoveAttachment: vi.fn(),
  intentClarification: null,
  isIntentSubmitting: false,
  onCancelIntentClarification: vi.fn(),
  onConfirmIntentClarification: vi.fn(),
});

const imageAttachment: ToolbarAttachment = {
  id: 'a1',
  name: '封面.png',
  kind: 'image',
  dataUrl: 'data:image/png;base64,AAAA',
};
const textAttachment: ToolbarAttachment = {
  id: 'a2',
  name: '大纲.md',
  kind: 'text',
  text: '# 大纲',
};

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

  it('右下角有「缩放至适应全部内容」按钮并回调', async () => {
    const user = userEvent.setup();
    const onZoomToFit = vi.fn();
    render(<CanvasToolbar {...defaultProps()} onZoomToFit={onZoomToFit} />);

    const btn = screen.getByRole('button', { name: 'canvas.zoom_to_fit' });
    await user.click(btn);
    expect(onZoomToFit).toHaveBeenCalledTimes(1);
  });

  describe('新建节点改走自然语言：按钮已撤掉', () => {
    it('不再有「+ 新建」下拉', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      expect(container.querySelector('[data-testid="icon-Plus"]')).toBeNull();
      expect(screen.queryByText('sidebar.new_note')).toBeNull();
      expect(screen.queryByText('sidebar.new_theme_card')).toBeNull();
    });

    it('不再有「角色」下拉', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      expect(container.querySelector('[data-testid="icon-Bot"]')).toBeNull();
      expect(screen.queryByText('sidebar.agents')).toBeNull();
    });
  });

  describe('上传改为输入栏附件', () => {
    it('文件选择器可多选，accept 不含视频', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      const input = container.querySelector('input[type="file"]')!;
      expect(input).toHaveAttribute('accept', TOOLBAR_ATTACHMENT_ACCEPT);
      expect(input).toHaveAttribute('multiple');
      expect(TOOLBAR_ATTACHMENT_ACCEPT).not.toContain('video');
    });

    it('提示文案说明附件不会放到画布上', () => {
      const { container } = render(<CanvasToolbar {...defaultProps()} />);
      expect(container.querySelector('label[aria-label="canvas.attach_file"]')).toBeTruthy();
      expect(container.querySelector('label[aria-label="canvas.upload_file"]')).toBeNull();
    });

    it('选中文件后把 File 数组交给 onAddAttachments', () => {
      const onAddAttachments = vi.fn();
      const { container } = render(
        <CanvasToolbar {...defaultProps()} onAddAttachments={onAddAttachments} />,
      );
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], '大纲.md', { type: 'text/markdown' });
      fireEvent.change(input, { target: { files: [file] } });

      expect(onAddAttachments).toHaveBeenCalledTimes(1);
      expect(onAddAttachments.mock.calls[0][0]).toEqual([file]);
    });

    it('没有附件时不渲染附件区', () => {
      render(<CanvasToolbar {...defaultProps()} />);
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('列出附件文件名，图片与文档用不同图标', () => {
      render(
        <CanvasToolbar {...defaultProps()} attachments={[imageAttachment, textAttachment]} />,
      );
      expect(screen.getByText('封面.png')).toBeInTheDocument();
      expect(screen.getByText('大纲.md')).toBeInTheDocument();
      expect(screen.getByTestId('icon-Image')).toBeInTheDocument();
      expect(screen.getByTestId('icon-FileText')).toBeInTheDocument();
    });

    it('点 ✕ 按 id 移除对应附件', async () => {
      const user = userEvent.setup();
      const onRemoveAttachment = vi.fn();
      render(
        <CanvasToolbar
          {...defaultProps()}
          attachments={[imageAttachment, textAttachment]}
          onRemoveAttachment={onRemoveAttachment}
        />,
      );

      const removeButtons = screen.getAllByRole('button', { name: 'canvas.remove_attachment' });
      expect(removeButtons).toHaveLength(2);
      await user.click(removeButtons[1]);
      expect(onRemoveAttachment).toHaveBeenCalledWith('a2');
    });
  });
});
