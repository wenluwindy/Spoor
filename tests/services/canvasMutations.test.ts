import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  getCanvasHistoryState,
  resetCanvasHistoryForTests,
  undoCanvasHistory,
} from '../../src/services/canvasHistory';
import {
  addNodesAndEdgesRecorded,
  deleteNodesRecorded,
  resizeNodeRecorded,
  updateNodeRecorded,
} from '../../src/services/canvasMutations';

const CANVAS = 'c1';

function node(id: string, extra: Record<string, unknown> = {}) {
  return { id, canvasId: CANVAS, type: 'text', content: id, x: 0, y: 0, ...extra };
}

describe('canvasMutations', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    resetCanvasHistoryForTests();
  });

  it('addNodesAndEdgesRecorded 节点与边一起建且算一步撤销', async () => {
    await addNodesAndEdgesRecorded(
      CANVAS,
      [node('n1'), node('n2')],
      [{ id: 'e1', canvasId: CANVAS, from: 'n1', to: 'n2' }],
    );
    expect(await db.nodes.count()).toBe(2);
    expect(await db.edges.count()).toBe(1);

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.count()).toBe(0);
    expect(await db.edges.count()).toBe(0);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('addNodesAndEdgesRecorded 写边失败时整体回滚，不留半成品也不入栈', async () => {
    // 预置一条同 id 的边让 bulkAdd 撞主键：节点那半必须跟着回滚
    await db.edges.add({ id: 'e1', canvasId: CANVAS, from: 'x', to: 'y' });

    await expect(
      addNodesAndEdgesRecorded(
        CANVAS,
        [node('n1')],
        [{ id: 'e1', canvasId: CANVAS, from: 'n1', to: 'n2' }],
      ),
    ).rejects.toThrow();

    expect(await db.nodes.count()).toBe(0);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('deleteNodesRecorded 只删与被删节点相连的边，其余边保留', async () => {
    await db.nodes.bulkAdd([node('n1'), node('n2'), node('n3')]);
    await db.edges.bulkAdd([
      { id: 'e12', canvasId: CANVAS, from: 'n1', to: 'n2' },
      { id: 'e23', canvasId: CANVAS, from: 'n2', to: 'n3' },
    ]);
    resetCanvasHistoryForTests();

    await deleteNodesRecorded(CANVAS, ['n1']);
    expect(await db.edges.get('e12')).toBeUndefined();
    expect(await db.edges.get('e23')).toBeTruthy();
    expect(await db.nodes.count()).toBe(2);
  });

  it('deleteNodesRecorded 对不存在的 id 不写库也不入栈', async () => {
    await deleteNodesRecorded(CANVAS, ['ghost']);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('updateNodeRecorded 的 before 只装 patch 里真正变化的键', async () => {
    await db.nodes.add(node('n1', { content: '旧', width: 300 }));
    resetCanvasHistoryForTests();

    // width 传了但值没变：不该出现在补丁里，撤销时也不该回写它
    await updateNodeRecorded(CANVAS, 'n1', { content: '新', width: 300 });
    await db.nodes.update('n1', { width: 500 });

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ content: '旧', width: 500 });
  });

  it('resizeNodeRecorded 按节点分键：两张卡的拉伸不会并成一步', async () => {
    await db.nodes.bulkAdd([node('n1', { width: 100 }), node('n2', { width: 100 })]);
    resetCanvasHistoryForTests();

    await resizeNodeRecorded(CANVAS, 'n1', { width: 200 });
    await resizeNodeRecorded(CANVAS, 'n2', { width: 200 });

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n2')).toMatchObject({ width: 100 });
    expect(await db.nodes.get('n1')).toMatchObject({ width: 200 });
  });

  it('resizeNodeRecorded 同一张卡连续拉伸合并成一步', async () => {
    await db.nodes.add(node('n1', { width: 100 }));
    resetCanvasHistoryForTests();

    await resizeNodeRecorded(CANVAS, 'n1', { width: 150 });
    await resizeNodeRecorded(CANVAS, 'n1', { width: 220 });

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ width: 100 });
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });
});
