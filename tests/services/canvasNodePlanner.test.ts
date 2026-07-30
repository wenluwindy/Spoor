import { describe, it, expect } from 'vitest';
import {
  normalizeCanvasNodePlan,
  MAX_PLANNED_NODES,
  MAX_PLANNED_NODE_CHARS,
} from '../../src/services/canvasNodePlanner';

describe('normalizeCanvasNodePlan', () => {
  it('非对象一律降级为问答', () => {
    expect(normalizeCanvasNodePlan(null)).toEqual({ action: 'answer' });
    expect(normalizeCanvasNodePlan('create')).toEqual({ action: 'answer' });
    expect(normalizeCanvasNodePlan(42)).toEqual({ action: 'answer' });
  });

  it('action 不是 create 就是问答', () => {
    expect(normalizeCanvasNodePlan({ action: 'answer' })).toEqual({ action: 'answer' });
    expect(normalizeCanvasNodePlan({ action: 'whatever', nodes: [] })).toEqual({ action: 'answer' });
  });

  it('create 但没有 nodes 数组 → 问答', () => {
    expect(normalizeCanvasNodePlan({ action: 'create' })).toEqual({ action: 'answer' });
    expect(normalizeCanvasNodePlan({ action: 'create', nodes: 'a' })).toEqual({ action: 'answer' });
  });

  it('create 但节点全是空内容 → 问答（不建空节点）', () => {
    expect(
      normalizeCanvasNodePlan({ action: 'create', nodes: [{ type: 'text', content: '  ' }, {}] }),
    ).toEqual({ action: 'answer' });
  });

  it('保留有效节点，丢掉无效的', () => {
    const plan = normalizeCanvasNodePlan({
      action: 'create',
      nodes: [
        { type: 'text', content: '早上：写提纲' },
        { content: '' },
        { type: 'theme', content: '叙事结构' },
        null,
      ],
    });
    expect(plan).toEqual({
      action: 'create',
      nodes: [
        { type: 'text', content: '早上：写提纲' },
        { type: 'theme', content: '叙事结构' },
      ],
    });
  });

  it('未知 type 落回便签', () => {
    const plan = normalizeCanvasNodePlan({
      action: 'create',
      nodes: [{ type: 'image', content: 'x' }, { content: 'y' }],
    });
    expect(plan).toEqual({
      action: 'create',
      nodes: [
        { type: 'text', content: 'x' },
        { type: 'text', content: 'y' },
      ],
    });
  });

  it('content 去首尾空白', () => {
    const plan = normalizeCanvasNodePlan({
      action: 'create',
      nodes: [{ type: 'text', content: '  留白  ' }],
    });
    expect(plan).toEqual({ action: 'create', nodes: [{ type: 'text', content: '留白' }] });
  });

  it('节点数封顶，防止一次铺满画布', () => {
    const nodes = Array.from({ length: MAX_PLANNED_NODES + 8 }, (_, i) => ({
      type: 'text',
      content: `第 ${i} 条`,
    }));
    const plan = normalizeCanvasNodePlan({ action: 'create', nodes });
    expect(plan.action).toBe('create');
    if (plan.action !== 'create') throw new Error('unreachable');
    expect(plan.nodes).toHaveLength(MAX_PLANNED_NODES);
    expect(plan.nodes[0].content).toBe('第 0 条');
  });

  it('单张内容超长时截断', () => {
    const plan = normalizeCanvasNodePlan({
      action: 'create',
      nodes: [{ type: 'text', content: 'x'.repeat(MAX_PLANNED_NODE_CHARS + 200) }],
    });
    if (plan.action !== 'create') throw new Error('unreachable');
    expect(plan.nodes[0].content).toHaveLength(MAX_PLANNED_NODE_CHARS);
  });
});
