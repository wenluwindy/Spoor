import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useNodeActions } from '../../src/hooks/useNodeActions';
import { db } from '../../src/db';
import i18n from '../../src/i18n';

function useTestNodeActions() {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const edges: { from: string; to: string }[] = [];
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  return useNodeActions({
    activeCanvasId: 'default',
    nodesRef: nodesRef as React.RefObject<Record<string, HTMLElement | null>>,
    connectingFrom,
    setConnectingFrom,
    edges,
    selectedNodes,
    setSelectedNodes,
    transformRef: transformRef as React.RefObject<{ x: number; y: number; scale: number }>,
  });
}

describe('useNodeActions', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    localStorage.clear();
  });

  it('addTextNode 在数据库中创建 text 类型节点', async () => {
    const { result } = renderHook(() => useTestNodeActions());

    await act(async () => {
      await result.current.addTextNode();
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('text');
    expect(nodes[0].content).toBe('');
    expect(nodes[0].canvasId).toBe('default');
    expect(typeof nodes[0].x).toBe('number');
    expect(typeof nodes[0].y).toBe('number');
  });

  it('addThemeNode 在数据库中创建 theme 类型节点', async () => {
    const { result } = renderHook(() => useTestNodeActions());

    await act(async () => {
      await result.current.addThemeNode();
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('theme');
    expect(nodes[0].content).toBe(i18n.t('nodes.new_theme_title'));
    expect(nodes[0].canvasId).toBe('default');
  });

  it('deleteEdge 删除指定边', async () => {
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'a', to: 'b' });
    await db.edges.add({ id: 'e2', canvasId: 'default', from: 'c', to: 'd' });
    const { result } = renderHook(() => useTestNodeActions());

    act(() => {
      result.current.deleteEdge('e1');
    });

    await new Promise(r => setTimeout(r, 50));
    const edges = await db.edges.toArray();
    expect(edges.length).toBe(1);
    expect(edges[0].id).toBe('e2');
  });

  it('removeNodeId 删除节点及其关联边', async () => {
    await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.nodes.add({ id: 'n2', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
    await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' });
    await db.edges.add({ id: 'e2', canvasId: 'default', from: 'n2', to: 'n1' });

    const { result } = renderHook(() => useTestNodeActions());

    await act(async () => {
      result.current.removeNodeId('n1');
      await new Promise(r => setTimeout(r, 50));
    });

    const nodes = await db.nodes.toArray();
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe('n2');

    const edges = await db.edges.toArray();
    expect(edges.length).toBe(0);
  });
});
