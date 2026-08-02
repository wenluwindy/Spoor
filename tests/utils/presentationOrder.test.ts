import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import { buildPresentationOrder, type PresentationEdge } from '../../src/utils/presentationOrder';

function node(id: string, x = 0, y = 0, type = 'note'): CanvasNode {
  return { id, type, x, y };
}

function edge(from: string, to: string): PresentationEdge {
  return { from, to };
}

describe('buildPresentationOrder', () => {
  it('空画布返回空数组', () => {
    expect(buildPresentationOrder([], [])).toEqual([]);
  });

  it('链式连线按拓扑序展开', () => {
    // 位置故意与连线方向相反：拓扑序必须压过阅读顺序
    const nodes = [node('a', 0, 300), node('b', 0, 200), node('c', 0, 100)];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(buildPresentationOrder(nodes, edges)).toEqual(['a', 'b', 'c']);
  });

  it('分叉时同层按 y 再 x 排序', () => {
    const nodes = [
      node('root', 0, 0),
      node('low', 100, 200), // y 大，后讲
      node('high', 300, 100), // y 小，先讲
      node('same-y-right', 200, 100),
    ];
    const edges = [edge('root', 'low'), edge('root', 'high'), edge('root', 'same-y-right')];
    // 同层：y=100 的两个在前（x 小的 same-y-right 先），y=200 的最后
    expect(buildPresentationOrder(nodes, edges)).toEqual(['root', 'same-y-right', 'high', 'low']);
  });

  it('指定 startId 时从它出发', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 100), node('c', 0, 200)];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(buildPresentationOrder(nodes, edges, 'b')).toEqual(['b', 'c', 'a']);
  });

  it('startId 无效（不存在或是 frame）时回落到根', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 100), node('frame1', 0, 0, 'frame')];
    const edges = [edge('a', 'b')];
    expect(buildPresentationOrder(nodes, edges, 'ghost')).toEqual(['a', 'b']);
    expect(buildPresentationOrder(nodes, edges, 'frame1')).toEqual(['a', 'b']);
  });

  it('成环不死循环，环上每张卡只出现一次', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 100), node('c', 0, 200)];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    // 纯环没有根：全员有入边，按阅读顺序附加
    expect(buildPresentationOrder(nodes, edges)).toEqual(['a', 'b', 'c']);
    // 从环上任意一点开讲则沿环走一圈
    expect(buildPresentationOrder(nodes, edges, 'b')).toEqual(['b', 'c', 'a']);
  });

  it('自环同样安全', () => {
    const nodes = [node('a', 0, 0)];
    expect(buildPresentationOrder(nodes, [edge('a', 'a')])).toEqual(['a']);
  });

  it('不连通的孤岛按 y/x 附加在尾部', () => {
    const nodes = [
      node('root', 0, 0),
      node('child', 0, 100),
      node('island-low', 500, 300),
      node('island-high', 500, 50),
      node('island-left', 100, 300),
    ];
    const edges = [edge('root', 'child')];
    // 孤立卡片（没有任何连线）不算根：连通部分讲完，才按 y/x 轮到它们
    expect(buildPresentationOrder(nodes, edges)).toEqual([
      'root',
      'child',
      'island-high',
      'island-left',
      'island-low',
    ]);
  });

  it('指定 startId 时，其余连通块按 y/x 附加在尾部', () => {
    const nodes = [
      node('a', 0, 0),
      node('b', 0, 100),
      node('x', 500, 20),
      node('y', 500, 10),
    ];
    const edges = [edge('a', 'b'), edge('x', 'y')];
    expect(buildPresentationOrder(nodes, edges, 'a')).toEqual(['a', 'b', 'y', 'x']);
  });

  it('frame 节点被跳过，连到 frame 的边也不参与', () => {
    const nodes = [
      node('frame1', 0, 0, 'frame'),
      node('a', 0, 100),
      node('b', 0, 200),
    ];
    const edges = [edge('frame1', 'a'), edge('a', 'b'), edge('b', 'frame1')];
    expect(buildPresentationOrder(nodes, edges)).toEqual(['a', 'b']);
  });

  it('端点已不存在的边被忽略', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 100)];
    const edges = [edge('a', 'deleted'), edge('deleted', 'b'), edge('a', 'b')];
    expect(buildPresentationOrder(nodes, edges)).toEqual(['a', 'b']);
  });

  it('确定性：打乱输入顺序结果不变，坐标相同按 id 兜底', () => {
    const nodes = [
      node('n3', 100, 100),
      node('n1', 100, 100), // 与 n3 完全同位：id 决定先后
      node('n2', 50, 100),
      node('n4', 0, 0),
    ];
    const edges = [edge('n4', 'n2')];
    const forward = buildPresentationOrder(nodes, edges);
    const reversed = buildPresentationOrder([...nodes].reverse(), [...edges].reverse());
    expect(forward).toEqual(reversed);
    // 连通部分 n4→n2 在前；孤立的 n1 / n3 同位，按 id 兜底
    expect(forward).toEqual(['n4', 'n2', 'n1', 'n3']);
  });

  it('无任何连线时是纯阅读顺序（先 y 后 x）', () => {
    const nodes = [node('c', 0, 200), node('a', 100, 0), node('b', 0, 0)];
    expect(buildPresentationOrder(nodes, [])).toEqual(['b', 'a', 'c']);
  });
});
