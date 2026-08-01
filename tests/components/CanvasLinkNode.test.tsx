import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasLinkNode } from '../../src/components/nodes/CanvasLinkNode';
import type { Canvas, CanvasNode } from '../../src/db';

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

const CANVASES: Canvas[] = [
  { id: 'c1', name: '第一张', createdAt: 1, updatedAt: 1 },
  { id: 'c2', name: '研究笔记', createdAt: 2, updatedAt: 2 },
];

const node = (extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'canvasLink',
  targetCanvasId: 'c2',
  x: 0,
  y: 0,
  ...extra,
});

describe('CanvasLinkNode', () => {
  const onOpen = vi.fn();

  beforeEach(() => {
    onOpen.mockClear();
  });

  const renderNode = (props: Partial<React.ComponentProps<typeof CanvasLinkNode>> = {}) =>
    render(
      <CanvasLinkNode
        node={node()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        canvases={CANVASES}
        onOpen={onOpen}
        {...props}
      />,
    );

  it('显示目标画布的名字', () => {
    renderNode();
    expect(screen.getByText('研究笔记')).toBeInTheDocument();
  });

  it('显示目标画布上有多少张卡片', () => {
    renderNode({ targetNodeCount: 17 });
    expect(screen.getByText('nodes.canvas_link_count:{"count":17}')).toBeInTheDocument();
  });

  it('不知道规模时不显示计数', () => {
    renderNode();
    expect(screen.queryByText(/canvas_link_count/)).not.toBeInTheDocument();
  });

  it('点按钮跳到目标画布', () => {
    renderNode();
    fireEvent.click(screen.getByText('nodes.canvas_link_open'));
    expect(onOpen).toHaveBeenCalledWith('c2');
  });

  it('双击卡片也跳过去', () => {
    renderNode();
    fireEvent.doubleClick(screen.getByText('研究笔记'));
    expect(onOpen).toHaveBeenCalledWith('c2');
  });

  it('目标画布被删掉时显示提示而不是空白，卡片本身留着', () => {
    renderNode({ node: node({ targetCanvasId: '已经删了的画布' }) });
    expect(screen.getByText('nodes.canvas_link_missing')).toBeInTheDocument();
    expect(screen.getByText('nodes.canvas_link_label')).toBeInTheDocument();
  });

  it('目标不存在时双击不跳转', () => {
    renderNode({ node: node({ targetCanvasId: '已经删了的画布' }) });
    fireEvent.doubleClick(screen.getByText('nodes.canvas_link_missing'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
