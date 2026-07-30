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

  describe('落点', () => {
    it('addTextNode 传入坐标时精确落在该处', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.addTextNode({ x: 421, y: -37 });
      });

      const [node] = await db.nodes.toArray();
      expect(node.x).toBe(421);
      expect(node.y).toBe(-37);
    });

    it('addThemeNode 传入坐标时精确落在该处', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.addThemeNode({ x: 10, y: 20 });
      });

      const [node] = await db.nodes.toArray();
      expect(node.x).toBe(10);
      expect(node.y).toBe(20);
    });

    it('createNodeAt 按 nodeType 分发', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.createNodeAt('text', { x: 0, y: 0 });
        await result.current.createNodeAt('theme', { x: 5, y: 5 });
      });

      const types = (await db.nodes.toArray()).map((n) => n.type).sort();
      expect(types).toEqual(['text', 'theme']);
    });

    it('addAgentNodeAt 记录 agentConfigId', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.addAgentNodeAt('mirror', { x: 1, y: 2 });
      });

      const [node] = await db.nodes.toArray();
      expect(node.type).toBe('agent');
      expect(node.agentConfigId).toBe('mirror');
    });
  });

  describe('duplicateNode', () => {
    it('复制内容并稍作偏移，且不复制连线', async () => {
      await db.nodes.add({
        id: 'n1', canvasId: 'default', type: 'text', content: 'hello',
        layout: 2, width: 300, height: 200, x: 100, y: 50,
      });
      await db.nodes.add({ id: 'n2', canvasId: 'default', type: 'text', content: '', x: 0, y: 0 });
      await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' });

      const { result } = renderHook(() => useTestNodeActions());
      await act(async () => {
        await result.current.duplicateNode('n1');
      });

      const nodes = await db.nodes.toArray();
      expect(nodes).toHaveLength(3);
      const copy = nodes.find((n) => n.id !== 'n1' && n.id !== 'n2')!;
      expect(copy.content).toBe('hello');
      expect(copy.layout).toBe(2);
      expect(copy.width).toBe(300);
      expect(copy.x).toBe(120);
      expect(copy.y).toBe(70);
      expect(await db.edges.count()).toBe(1);
    });

    it('节点不存在时静默返回', async () => {
      const { result } = renderHook(() => useTestNodeActions());
      await act(async () => {
        await result.current.duplicateNode('missing');
      });
      expect(await db.nodes.count()).toBe(0);
    });
  });

  describe('cycleNodeLayout', () => {
    it('便签在 0..4 之间轮换并回环', async () => {
      await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', layout: 4, x: 0, y: 0 });
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.cycleNodeLayout('n1');
      });

      expect((await db.nodes.get('n1'))!.layout).toBe(0);
    });

    it('主题卡在 0..3 之间轮换并回环', async () => {
      await db.nodes.add({ id: 't1', canvasId: 'default', type: 'theme', layout: 3, x: 0, y: 0 });
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.cycleNodeLayout('t1');
      });

      expect((await db.nodes.get('t1'))!.layout).toBe(0);
    });

    it('不支持版式轮换的类型不受影响', async () => {
      await db.nodes.add({ id: 'i1', canvasId: 'default', type: 'image', layout: 1, x: 0, y: 0 });
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.cycleNodeLayout('i1');
      });

      expect((await db.nodes.get('i1'))!.layout).toBe(1);
    });
  });

  describe('pasteStickyAt', () => {
    it('整体落到目标点并保留多张之间的相对位置', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.pasteStickyAt(
          {
            kind: 'scribe-sticky-v1',
            nodes: [
              { type: 'text', content: 'a', x: 100, y: 200 },
              { type: 'text', content: 'b', x: 140, y: 260 },
            ],
          },
          { x: 0, y: 0 },
        );
      });

      const nodes = (await db.nodes.toArray()).sort((a, b) => a.x - b.x);
      expect(nodes.map((n) => [n.x, n.y])).toEqual([
        [0, 0],
        [40, 60],
      ]);
    });
  });

  describe('deleteNodes', () => {
    it('批量删除节点及其全部关联边', async () => {
      await db.nodes.bulkAdd([
        { id: 'n1', canvasId: 'default', type: 'text', x: 0, y: 0 },
        { id: 'n2', canvasId: 'default', type: 'text', x: 0, y: 0 },
        { id: 'n3', canvasId: 'default', type: 'text', x: 0, y: 0 },
      ]);
      await db.edges.bulkAdd([
        { id: 'e1', canvasId: 'default', from: 'n1', to: 'n2' },
        { id: 'e2', canvasId: 'default', from: 'n2', to: 'n3' },
        { id: 'e3', canvasId: 'default', from: 'n3', to: 'n3' },
      ]);

      const { result } = renderHook(() => useTestNodeActions());
      await act(async () => {
        await result.current.deleteNodes(['n1', 'n2']);
      });

      expect((await db.nodes.toArray()).map((n) => n.id)).toEqual(['n3']);
      expect((await db.edges.toArray()).map((e) => e.id)).toEqual(['e3']);
    });

    it('空数组不做任何事', async () => {
      await db.nodes.add({ id: 'n1', canvasId: 'default', type: 'text', x: 0, y: 0 });
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.deleteNodes([]);
      });

      expect(await db.nodes.count()).toBe(1);
    });
  });

  describe('linkNodesToHub', () => {
    it('其余节点全部连到中心节点', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.linkNodesToHub(['n1', 'n2', 'n3'], 'n2');
      });

      const edges = await db.edges.toArray();
      expect(edges).toHaveLength(2);
      expect(edges.every((e) => e.from === 'n2')).toBe(true);
      expect(edges.map((e) => e.to).sort()).toEqual(['n1', 'n3']);
    });

    it('中心节点不连自己', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.linkNodesToHub(['n1'], 'n1');
      });

      expect(await db.edges.count()).toBe(0);
    });

    it('重复执行不产生重复连线', async () => {
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.linkNodesToHub(['n1', 'n2'], 'n1');
        await result.current.linkNodesToHub(['n1', 'n2'], 'n1');
      });

      expect(await db.edges.count()).toBe(1);
    });

    it('已存在反向连线时也不重复建', async () => {
      await db.edges.add({ id: 'e1', canvasId: 'default', from: 'n2', to: 'n1' });
      const { result } = renderHook(() => useTestNodeActions());

      await act(async () => {
        await result.current.linkNodesToHub(['n1', 'n2'], 'n1');
      });

      expect(await db.edges.count()).toBe(1);
    });
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
