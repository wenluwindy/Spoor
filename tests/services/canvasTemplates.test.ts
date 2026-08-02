import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasNode } from '../../src/db';
import {
  resetCanvasHistoryForTests,
  undoCanvasHistory,
} from '../../src/services/canvasHistory';
import {
  deleteCanvasTemplate,
  insertCanvasTemplate,
  saveCanvasTemplate,
} from '../../src/services/canvasTemplates';

const node = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'src',
  type: 'text',
  content: id,
  x,
  y,
  ...extra,
});

describe('canvasTemplates', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    await db.templates.clear();
    resetCanvasHistoryForTests();
  });

  it('保存归一化坐标，只带选区内部的边', async () => {
    const id = await saveCanvasTemplate(
      '研究骨架',
      [node('a', 100, 200), node('b', 400, 260)],
      [
        { id: 'e1', canvasId: 'src', from: 'a', to: 'b' },
        { id: 'e2', canvasId: 'src', from: 'a', to: 'outside' },
      ],
    );
    const saved = await db.templates.get(id!);
    expect(saved?.name).toBe('研究骨架');
    expect(saved?.nodes.map((n) => ({ x: n.x, y: n.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 60 },
    ]);
    expect(saved?.edges).toHaveLength(1);
  });

  it('插入时重发 id、放到目标点、保持相对位置，整批一步撤销', async () => {
    const tplId = await saveCanvasTemplate(
      't',
      [node('a', 0, 0), node('b', 300, 60)],
      [{ id: 'e1', canvasId: 'src', from: 'a', to: 'b' }],
    );

    const createdIds = await insertCanvasTemplate(tplId!, 'target', { x: 1000, y: 500 });
    expect(createdIds).toHaveLength(2);

    const rows = await db.nodes.where('canvasId').equals('target').toArray();
    const xs = rows.map((r) => r.x).sort((a, b) => a - b);
    expect(xs).toEqual([1000, 1300]);
    // id 全新，不与模板里的原 id 撞车
    expect(rows.every((r) => r.id !== 'a' && r.id !== 'b')).toBe(true);

    const edges = await db.edges.where('canvasId').equals('target').toArray();
    expect(edges).toHaveLength(1);
    expect(createdIds).toContain(edges[0].from);
    expect(createdIds).toContain(edges[0].to);

    await undoCanvasHistory('target');
    expect(await db.nodes.where('canvasId').equals('target').count()).toBe(0);
    expect(await db.edges.where('canvasId').equals('target').count()).toBe(0);
  });

  it('同一模板可以插入多次，各自独立', async () => {
    const tplId = await saveCanvasTemplate('t', [node('a', 0, 0)], []);
    await insertCanvasTemplate(tplId!, 'target', { x: 0, y: 0 });
    await insertCanvasTemplate(tplId!, 'target', { x: 500, y: 0 });
    expect(await db.nodes.where('canvasId').equals('target').count()).toBe(2);
  });

  it('删除模板；插入不存在的模板静默无事', async () => {
    const tplId = await saveCanvasTemplate('t', [node('a', 0, 0)], []);
    await deleteCanvasTemplate(tplId!);
    expect(await db.templates.count()).toBe(0);
    expect(await insertCanvasTemplate(tplId!, 'target', { x: 0, y: 0 })).toEqual([]);
  });
});
