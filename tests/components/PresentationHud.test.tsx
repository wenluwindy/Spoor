import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CanvasNode } from '../../src/db';
import {
  PresentationHud,
  presentationNodeSummary,
  PRESENTATION_SUMMARY_LENGTH,
} from '../../src/components/canvas/PresentationHud';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

function node(id: string, content?: string): CanvasNode {
  return { id, type: 'note', x: 0, y: 0, content };
}

describe('presentationNodeSummary', () => {
  it('取最像标题的字段并压平空白', () => {
    expect(presentationNodeSummary(node('a', '第一行\n  第二行'))).toBe('第一行 第二行');
  });

  it('超过 30 字截断并加省略号', () => {
    const long = '甲'.repeat(40);
    const summary = presentationNodeSummary(node('a', long));
    expect(summary).toBe(`${'甲'.repeat(PRESENTATION_SUMMARY_LENGTH)}…`);
  });

  it('没有文字或节点缺失时返回空串', () => {
    expect(presentationNodeSummary(node('a'))).toBe('');
    expect(presentationNodeSummary(undefined)).toBe('');
  });

  it('便签没正文时退到 description / 文件名', () => {
    expect(presentationNodeSummary({ id: 'f', type: 'image', x: 0, y: 0, fileName: '封面.png' })).toBe(
      '封面.png',
    );
  });
});

describe('PresentationHud', () => {
  const nodes = [node('a', '开场白'), node('b', '论点一'), node('c', '结尾')];
  const props = {
    active: true,
    order: ['a', 'b', 'c'],
    index: 1,
    nodes,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onJumpTo: vi.fn(),
    onApplyOrder: vi.fn(),
    onExit: vi.fn(),
  };

  beforeEach(() => {
    props.onPrev.mockClear();
    props.onNext.mockClear();
    props.onJumpTo.mockClear();
    props.onApplyOrder.mockClear();
    props.onExit.mockClear();
  });

  const openOrderPanel = () => fireEvent.click(screen.getByLabelText('canvas.presentation.order'));

  it('未激活或空顺序时不渲染', () => {
    const { container, rerender } = render(<PresentationHud {...props} active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PresentationHud {...props} order={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('显示 当前/总数 计数（index 0 起，显示 +1）', () => {
    render(<PresentationHud {...props} />);
    expect(
      screen.getByText('canvas.presentation.position:{"index":2,"total":3}'),
    ).toBeInTheDocument();
  });

  it('上一张/下一张/退出按钮各自触发回调', () => {
    render(<PresentationHud {...props} />);
    fireEvent.click(screen.getByLabelText('canvas.presentation.prev'));
    fireEvent.click(screen.getByLabelText('canvas.presentation.next'));
    fireEvent.click(screen.getByLabelText('canvas.presentation.exit'));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('第一张时禁用上一张，最后一张时禁用下一张', () => {
    const { rerender } = render(<PresentationHud {...props} index={0} />);
    expect(screen.getByLabelText('canvas.presentation.prev')).toBeDisabled();
    expect(screen.getByLabelText('canvas.presentation.next')).not.toBeDisabled();

    rerender(<PresentationHud {...props} index={2} />);
    expect(screen.getByLabelText('canvas.presentation.prev')).not.toBeDisabled();
    expect(screen.getByLabelText('canvas.presentation.next')).toBeDisabled();
  });

  it('显示「点击空白也翻页」的说明', () => {
    render(<PresentationHud {...props} />);
    expect(screen.getByText('canvas.presentation.blank_click_hint')).toBeInTheDocument();
  });

  it('顺序面板：列出每张卡的序号与摘要，无文字的卡用占位', () => {
    const withEmpty = [...nodes, node('d')];
    render(<PresentationHud {...props} nodes={withEmpty} order={['a', 'b', 'c', 'd']} />);
    openOrderPanel();

    expect(screen.getByText('canvas.presentation.order_title')).toBeInTheDocument();
    expect(screen.getByText('开场白')).toBeInTheDocument();
    expect(screen.getByText('论点一')).toBeInTheDocument();
    expect(screen.getByText('结尾')).toBeInTheDocument();
    expect(screen.getByText('canvas.presentation.untitled')).toBeInTheDocument();
  });

  it('顺序面板：点摘要跳到那张卡（按当前播放序的位置）', () => {
    render(<PresentationHud {...props} />);
    openOrderPanel();
    fireEvent.click(screen.getByText('结尾'));
    expect(props.onJumpTo).toHaveBeenCalledWith(2);
  });

  it('顺序面板：↑↓ 只改草稿，点确定才应用新顺序', () => {
    render(<PresentationHud {...props} />);
    openOrderPanel();

    // 把第一行（开场白）往下挪一位
    fireEvent.click(screen.getAllByLabelText('canvas.presentation.move_down')[0]);
    expect(props.onApplyOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('canvas.presentation.apply_order'));
    expect(props.onApplyOrder).toHaveBeenCalledWith(['b', 'a', 'c']);
    // 确定后面板收起
    expect(screen.queryByText('canvas.presentation.order_title')).not.toBeInTheDocument();
  });

  it('顺序面板：首行禁用上移，末行禁用下移', () => {
    render(<PresentationHud {...props} />);
    openOrderPanel();
    const ups = screen.getAllByLabelText('canvas.presentation.move_up');
    const downs = screen.getAllByLabelText('canvas.presentation.move_down');
    expect(ups[0]).toBeDisabled();
    expect(ups[2]).not.toBeDisabled();
    expect(downs[2]).toBeDisabled();
    expect(downs[0]).not.toBeDisabled();
  });

  it('顺序面板：点取消丢弃草稿不应用', () => {
    render(<PresentationHud {...props} />);
    openOrderPanel();
    fireEvent.click(screen.getAllByLabelText('canvas.presentation.move_down')[0]);
    fireEvent.click(screen.getByText('canvas.presentation.cancel_order'));

    expect(props.onApplyOrder).not.toHaveBeenCalled();
    expect(screen.queryByText('canvas.presentation.order_title')).not.toBeInTheDocument();

    // 重新打开时草稿回到当前播放序（行文本 = 序号 + 摘要）
    openOrderPanel();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['1开场白', '2论点一', '3结尾']);
  });
});
