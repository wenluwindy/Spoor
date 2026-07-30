import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';
import { CanvasEdgeLines } from '../../src/components/canvas/CanvasEdgeLines';
import type { Edge } from '../../src/db';

describe('CanvasEdgeLines', () => {
  const defaultProps = {
    edges: [] as Edge[],
    connectingFrom: null as string | null,
    svgRef: createRef<SVGSVGElement>(),
    edgeLabelsRef: createRef<HTMLDivElement>(),
    hoveredEdgeId: null as string | null,
    setHoveredEdgeId: vi.fn(),
    deleteEdge: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 edges 时只渲染 temp-edge', () => {
    const { container } = render(<CanvasEdgeLines {...defaultProps} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // temp-edge 是直接在 svg 下的 <line>，不在 <g> 中
    const tempEdge = container.querySelector('#temp-edge');
    expect(tempEdge).toBeInTheDocument();
    const groups = container.querySelectorAll('g[data-edge-id]');
    expect(groups.length).toBe(0);
  });

  it('渲染正确数量的 edge groups', () => {
    const edges = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'c', to: 'd' },
    ] as Edge[];

    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const groups = container.querySelectorAll('g[data-edge-id]');
    expect(groups.length).toBe(2);
    expect(container.querySelector('[data-edge-from="a"]')).toBeInTheDocument();
    expect(container.querySelector('[data-edge-from="c"]')).toBeInTheDocument();
  });

  it('每个 edge group 渲染 2 条线（视觉线 + hit area）', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(<CanvasEdgeLines {...defaultProps} edges={edges} />);
    const lines = container.querySelectorAll('g[data-edge-id="e1"] line');
    expect(lines.length).toBe(2);
  });

  it('hovered edge 对应的删除按钮可见', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-100');
  });

  it('非 hovered edge 对应的删除按钮不可见', () => {
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId={null} />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]');
    expect(btn).toHaveClass('opacity-0');
  });

  it('connectingFrom 存在时 temp-edge 可见', () => {
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} connectingFrom="node-a" />
    );
    const tempEdge = container.querySelector('#temp-edge') as SVGLineElement;
    expect(tempEdge.style.display).toBe('block');
  });

  it('connectingFrom 为 null 时 temp-edge 隐藏', () => {
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} connectingFrom={null} />
    );
    const tempEdge = container.querySelector('#temp-edge') as SVGLineElement;
    expect(tempEdge.style.display).toBe('none');
  });

  it('点击删除按钮调用 deleteEdge', () => {
    const deleteEdge = vi.fn();
    const edges = [{ id: 'e1', from: 'a', to: 'b' }] as Edge[];
    const { container } = render(
      <CanvasEdgeLines {...defaultProps} edges={edges} hoveredEdgeId="e1" deleteEdge={deleteEdge} />
    );
    const btn = container.querySelector('[data-edge-btn="e1"]')!;
    fireEvent.pointerDown(btn);
    expect(deleteEdge).toHaveBeenCalledWith('e1');
  });
});
