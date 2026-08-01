import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CanvasNode, Edge } from '../../src/db';
import { useCanvasRecompute } from '../../src/hooks/useCanvasRecompute';

const node = (id: string, type: string): CanvasNode => ({ id, canvasId: 'c1', type, x: 0, y: 0 });
const edge = (from: string, to: string): Edge => ({ id: `${from}->${to}`, canvasId: 'c1', from, to });

describe('useCanvasRecompute', () => {
  const regenerateAiNode = vi.fn<(id: string) => Promise<'ok' | 'skipped' | 'failed'>>();
  const regenerateImageNode = vi.fn<(id: string) => Promise<void>>();

  beforeEach(() => {
    regenerateAiNode.mockReset().mockResolvedValue('ok');
    regenerateImageNode.mockReset().mockResolvedValue(undefined);
  });

  const mount = (nodes: CanvasNode[], edges: Edge[]) =>
    renderHook(() =>
      useCanvasRecompute({ nodes, edges, regenerateAiNode, regenerateImageNode }),
    );

  it('按依赖顺序一个一个跑，不并发', async () => {
    const order: string[] = [];
    regenerateAiNode.mockImplementation(async (id) => {
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${id}`);
      return 'ok';
    });

    const { result } = mount(
      [node('note', 'text'), node('ai1', 'ai'), node('ai2', 'ai')],
      [edge('note', 'ai1'), edge('ai1', 'ai2')],
    );

    await act(async () => {
      await result.current.recompute('note');
    });

    // 交错就说明并发了
    expect(order).toEqual(['start:ai1', 'end:ai1', 'start:ai2', 'end:ai2']);
  });

  it('AI 卡与生图节点各走各的重跑通道', async () => {
    const { result } = mount(
      [node('note', 'text'), node('ai1', 'ai'), node('gen', 'imagegen')],
      [edge('note', 'ai1'), edge('note', 'gen')],
    );

    await act(async () => {
      await result.current.recompute('note');
    });

    expect(regenerateAiNode).toHaveBeenCalledWith('ai1');
    expect(regenerateImageNode).toHaveBeenCalledWith('gen');
  });

  it('汇总跑了几个、跳过几个、失败几个', async () => {
    regenerateAiNode.mockImplementation(async (id) => (id === 'ai1' ? 'ok' : 'skipped'));

    let summary!: Awaited<ReturnType<typeof result.current.recompute>>;
    const { result } = mount(
      [node('note', 'text'), node('ai1', 'ai'), node('ai2', 'ai'), node('gen', 'imagegen')],
      [edge('note', 'ai1'), edge('note', 'ai2'), edge('note', 'gen')],
    );

    await act(async () => {
      summary = await result.current.recompute('note');
    });

    expect(summary).toEqual({ ran: 2, skipped: 1, failed: 0 });
  });

  it('某一个抛错不影响后面的继续跑', async () => {
    regenerateAiNode.mockImplementation(async (id) => {
      if (id === 'ai1') throw new Error('boom');
      return 'ok';
    });

    let summary!: Awaited<ReturnType<typeof result.current.recompute>>;
    const { result } = mount(
      [node('note', 'text'), node('ai1', 'ai'), node('ai2', 'ai')],
      [edge('note', 'ai1'), edge('note', 'ai2')],
    );

    await act(async () => {
      summary = await result.current.recompute('note');
    });

    expect(summary).toMatchObject({ ran: 1, failed: 1 });
    expect(regenerateAiNode).toHaveBeenCalledWith('ai2');
  });

  it('下游没有可重算节点时什么都不做', async () => {
    const { result } = mount([node('note', 'text'), node('img', 'image')], [edge('note', 'img')]);

    let summary!: Awaited<ReturnType<typeof result.current.recompute>>;
    await act(async () => {
      summary = await result.current.recompute('note');
    });

    expect(summary).toEqual({ ran: 0, skipped: 0, failed: 0 });
    expect(regenerateAiNode).not.toHaveBeenCalled();
  });

  it('includeStart 时连自己一起重跑', async () => {
    const { result } = mount([node('ai1', 'ai'), node('ai2', 'ai')], [edge('ai1', 'ai2')]);

    await act(async () => {
      await result.current.recompute('ai1', true);
    });

    expect(regenerateAiNode.mock.calls.map((c) => c[0])).toEqual(['ai1', 'ai2']);
  });

  it('跑完之后清空进行中的集合', async () => {
    const { result } = mount([node('note', 'text'), node('ai1', 'ai')], [edge('note', 'ai1')]);

    await act(async () => {
      await result.current.recompute('note');
    });

    expect(result.current.recomputingNodeIds.size).toBe(0);
    expect(result.current.isRecomputing).toBe(false);
  });
});
