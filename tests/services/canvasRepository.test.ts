import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { deleteCanvasWithContents } from '../../src/services/canvasRepository';

async function seed() {
  await db.canvases.bulkAdd([
    { id: 'default', name: '默认', createdAt: 1, updatedAt: 1 },
    { id: 'c2', name: '第二张', createdAt: 2, updatedAt: 2 },
  ]);
  await db.nodes.bulkAdd([
    { id: 'n-default', canvasId: 'default', type: 'text', content: 'a', x: 0, y: 0 },
    { id: 'n-legacy', type: 'text', content: '旧数据没有 canvasId', x: 0, y: 0 },
    { id: 'n-c2-1', canvasId: 'c2', type: 'text', content: 'b', x: 0, y: 0 },
    { id: 'n-c2-2', canvasId: 'c2', type: 'theme', content: 'c', x: 0, y: 0 },
  ]);
  await db.edges.bulkAdd([
    { id: 'e-default', canvasId: 'default', from: 'n-default', to: 'n-legacy' },
    { id: 'e-legacy', from: 'n-legacy', to: 'n-default' },
    { id: 'e-c2', canvasId: 'c2', from: 'n-c2-1', to: 'n-c2-2' },
  ]);
}

describe('deleteCanvasWithContents', () => {
  beforeEach(async () => {
    await db.canvases.clear();
    await db.nodes.clear();
    await db.edges.clear();
    await db.articles.clear();
    await seed();
  });

  it('删掉画布本身', async () => {
    await deleteCanvasWithContents('c2');
    expect(await db.canvases.get('c2')).toBeUndefined();
    expect(await db.canvases.get('default')).toBeDefined();
  });

  it('连同该画布的节点一起删', async () => {
    await deleteCanvasWithContents('c2');
    const ids = (await db.nodes.toArray()).map((n) => n.id).sort();
    expect(ids).toEqual(['n-default', 'n-legacy']);
  });

  it('连同该画布的连线一起删', async () => {
    await deleteCanvasWithContents('c2');
    const ids = (await db.edges.toArray()).map((e) => e.id).sort();
    expect(ids).toEqual(['e-default', 'e-legacy']);
  });

  it('不碰其他画布的内容', async () => {
    await deleteCanvasWithContents('default');
    const ids = (await db.nodes.toArray()).map((n) => n.id).sort();
    expect(ids).toEqual(['n-c2-1', 'n-c2-2']);
  });

  it('删 default 时把没有 canvasId 的旧数据也清掉', async () => {
    await deleteCanvasWithContents('default');
    expect(await db.nodes.get('n-legacy')).toBeUndefined();
    expect(await db.edges.get('e-legacy')).toBeUndefined();
  });

  it('长文里指向该画布的引用被摘掉，其余保留', async () => {
    await db.articles.add({
      id: 'a1',
      title: '稿子',
      content: '',
      date: '2026',
      type: 'GEN-1',
      linkedCanvasIds: ['default', 'c2'],
    });
    await deleteCanvasWithContents('c2');
    expect((await db.articles.get('a1'))?.linkedCanvasIds).toEqual(['default']);
  });

  it('没有关联长文时不报错', async () => {
    await db.articles.add({ id: 'a2', title: 'x', content: '', date: '2026', type: 'GEN-2' });
    await expect(deleteCanvasWithContents('c2')).resolves.toBeUndefined();
    expect(await db.articles.get('a2')).toBeDefined();
  });

  it('删不存在的画布是空操作，不抛错', async () => {
    await expect(deleteCanvasWithContents('nope')).resolves.toBeUndefined();
    expect(await db.canvases.count()).toBe(2);
    expect(await db.nodes.count()).toBe(4);
  });
});
