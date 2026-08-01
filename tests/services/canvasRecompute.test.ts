import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  collectDownstreamIds,
  isRecomputable,
  planRecompute,
  topologicalOrder,
} from '../../src/services/canvasRecompute';

const node = (id: string, type: string): CanvasNode => ({
  id,
  canvasId: 'c1',
  type,
  x: 0,
  y: 0,
});

const edge = (from: string, to: string): Edge => ({
  id: `${from}->${to}`,
  canvasId: 'c1',
  from,
  to,
});

describe('canvasRecompute', () => {
  describe('下游收集', () => {
    it('顺着箭头一路走到底', () => {
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
      expect([...collectDownstreamIds('a', edges)].sort()).toEqual(['b', 'c', 'd']);
    });

    it('只沿箭头方向——上游不算下游', () => {
      const edges = [edge('a', 'b'), edge('x', 'a')];
      expect([...collectDownstreamIds('a', edges)]).toEqual(['b']);
    });

    it('不含起点自己', () => {
      expect(collectDownstreamIds('a', [edge('a', 'b'), edge('b', 'a')]).has('a')).toBe(false);
    });

    it('分叉合流各走一次，不重复', () => {
      const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
      expect([...collectDownstreamIds('a', edges)].sort()).toEqual(['b', 'c', 'd']);
    });

    it('成环不会转不出来', () => {
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')];
      expect([...collectDownstreamIds('a', edges)].sort()).toEqual(['b', 'c']);
    });

    it('没有下游时返回空集', () => {
      expect(collectDownstreamIds('a', []).size).toBe(0);
    });
  });

  describe('拓扑排序', () => {
    it('上游排在下游之前', () => {
      expect(topologicalOrder(['c', 'a', 'b'], [edge('a', 'b'), edge('b', 'c')])).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('只看这批节点内部的边', () => {
      // x 不在范围内，它指向 a 的那条边不该让 a 一直等下去
      expect(topologicalOrder(['a', 'b'], [edge('x', 'a'), edge('a', 'b')])).toEqual(['a', 'b']);
    });

    it('同层保持传入顺序，先后可预期', () => {
      expect(topologicalOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
    });

    it('成环的部分缀在最后，而不是一个都不跑', () => {
      const ordered = topologicalOrder(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')]);
      expect(ordered[0]).toBe('a');
      expect(ordered.sort()).toEqual(['a', 'b', 'c']);
    });

    it('自环不会把自己卡住', () => {
      expect(topologicalOrder(['a'], [edge('a', 'a')])).toEqual(['a']);
    });
  });

  describe('可重算判定', () => {
    it('只有 AI 卡与生图节点能重算', () => {
      expect(isRecomputable(node('n', 'ai'))).toBe(true);
      expect(isRecomputable(node('n', 'imagegen'))).toBe(true);
      expect(isRecomputable(node('n', 'text'))).toBe(false);
      expect(isRecomputable(node('n', 'image'))).toBe(false);
      expect(isRecomputable(undefined)).toBe(false);
    });
  });

  describe('重算计划', () => {
    const nodes = [
      node('note', 'text'),
      node('ai1', 'ai'),
      node('gen', 'imagegen'),
      node('ai2', 'ai'),
      node('img', 'image'),
    ];

    it('从一张便签出发，按依赖顺序列出下游的 AI 与生图节点', () => {
      const edges = [edge('note', 'ai1'), edge('ai1', 'gen'), edge('gen', 'ai2')];
      expect(planRecompute('note', nodes, edges)).toEqual(['ai1', 'gen', 'ai2']);
    });

    it('筛掉不可重算的类型，但它们仍然参与传递依赖', () => {
      // note → img（图片，不重算）→ ai1：ai1 依然要排在后面
      const edges = [edge('note', 'img'), edge('img', 'ai1')];
      expect(planRecompute('note', nodes, edges)).toEqual(['ai1']);
    });

    it('默认不含起点自己', () => {
      const edges = [edge('ai1', 'ai2')];
      expect(planRecompute('ai1', nodes, edges)).toEqual(['ai2']);
    });

    it('要求包含起点时它排在最前', () => {
      const edges = [edge('ai1', 'ai2')];
      expect(planRecompute('ai1', nodes, edges, true)).toEqual(['ai1', 'ai2']);
    });

    it('起点自己不可重算时，即使要求包含也不会混进来', () => {
      const edges = [edge('note', 'ai1')];
      expect(planRecompute('note', nodes, edges, true)).toEqual(['ai1']);
    });

    it('下游没有可重算节点时返回空', () => {
      expect(planRecompute('note', nodes, [edge('note', 'img')])).toEqual([]);
    });
  });
});
