import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { MyDatabase } from '../src/db';

/**
 * v5 迁移：历史行补 canvasId 与时间戳。
 * 用独立库名模拟一个停留在 v4 的旧库，再用产品 schema 打开走真实升级链——
 * 这是 0.4.0 第一次使用 Dexie 的 upgrade()，值得单独按住。
 */
describe('Dexie v5 迁移', () => {
  it('旧行补齐 canvasId 与时间戳，已有值的行原样保留', async () => {
    const name = `migration-test-${Math.random().toString(36).slice(2)}`;

    // 先按 v4 的样子建库：nodes 无 tags/updatedAt 索引，行里没有 canvasId
    const legacy = new Dexie(name);
    legacy.version(4).stores({
      nodes: '++id, type, agentConfigId, canvasId',
      articles: '++id, type, date',
      agents: '++id, role',
      edges: '++id, from, to, canvasId',
      canvases: '++id, name, createdAt',
      researchSessions: 'id, createdAt',
      agentSandboxThreads: 'agentId',
    });
    await legacy.table('nodes').bulkAdd([
      { id: 'old', type: 'text', content: '旧行', x: 0, y: 0 },
      { id: 'kept', canvasId: 'c9', type: 'text', content: '已归属', x: 0, y: 0, createdAt: 111, updatedAt: 222 },
    ]);
    await legacy.table('edges').add({ id: 'e-old', from: 'old', to: 'kept' });
    legacy.close();

    const upgraded = new MyDatabase(name);
    try {
      const old = await upgraded.nodes.get('old');
      expect(old?.canvasId).toBe('default');
      expect(old?.createdAt).toBeGreaterThan(0);
      expect(old?.updatedAt).toBe(old?.createdAt);

      const kept = await upgraded.nodes.get('kept');
      expect(kept).toMatchObject({ canvasId: 'c9', createdAt: 111, updatedAt: 222 });

      expect((await upgraded.edges.get('e-old'))?.canvasId).toBe('default');

      // 迁移后 where('canvasId') 必须能查到补齐的行——这是删掉热路径兜底的前提
      const defaults = await upgraded.nodes.where('canvasId').equals('default').toArray();
      expect(defaults.map((n) => n.id)).toEqual(['old']);

      // 新表就位
      expect(upgraded.tables.map((t) => t.name)).toEqual(
        expect.arrayContaining(['aiTurns', 'templates']),
      );
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });

  it('hook 给新建的行自动盖章：canvasId 兜底 default，时间戳非空', async () => {
    const name = `hook-test-${Math.random().toString(36).slice(2)}`;
    const fresh = new MyDatabase(name);
    try {
      await fresh.nodes.add({ id: 'n1', type: 'text', x: 0, y: 0 });
      const row = await fresh.nodes.get('n1');
      expect(row?.canvasId).toBe('default');
      expect(row?.createdAt).toBeGreaterThan(0);
      expect(row?.updatedAt).toBe(row?.createdAt);

      // update 自动碰 updatedAt；显式携带 updatedAt（撤销还原）时不覆盖
      await new Promise((r) => setTimeout(r, 5));
      await fresh.nodes.update('n1', { content: '改' });
      const bumped = await fresh.nodes.get('n1');
      expect(bumped!.updatedAt!).toBeGreaterThan(row!.updatedAt!);

      await fresh.nodes.update('n1', { content: '还原', updatedAt: 42 });
      expect((await fresh.nodes.get('n1'))?.updatedAt).toBe(42);

      await fresh.edges.add({ id: 'e1', from: 'a', to: 'b' });
      const edge = await fresh.edges.get('e1');
      expect(edge?.canvasId).toBe('default');
      expect(edge?.createdAt).toBeGreaterThan(0);
    } finally {
      fresh.close();
      await Dexie.delete(name);
    }
  });

  it('nodes 的 *tags multiEntry 索引可按单个标签查', async () => {
    const name = `tags-test-${Math.random().toString(36).slice(2)}`;
    const fresh = new MyDatabase(name);
    try {
      await fresh.nodes.bulkAdd([
        { id: 'a', type: 'text', x: 0, y: 0, tags: ['重要', '待办'] },
        { id: 'b', type: 'text', x: 0, y: 0, tags: ['待办'] },
        { id: 'c', type: 'text', x: 0, y: 0 },
      ]);
      const hits = await fresh.nodes.where('tags').equals('重要').toArray();
      expect(hits.map((n) => n.id)).toEqual(['a']);
      const todos = await fresh.nodes.where('tags').equals('待办').toArray();
      expect(todos.map((n) => n.id).sort()).toEqual(['a', 'b']);
    } finally {
      fresh.close();
      await Dexie.delete(name);
    }
  });
});
