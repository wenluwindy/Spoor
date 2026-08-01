import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  CANVAS_HISTORY_LIMIT,
  clearCanvasHistory,
  getCanvasHistoryState,
  mergePatches,
  recordCanvasHistory,
  redoCanvasHistory,
  resetCanvasHistoryForTests,
  subscribeCanvasHistory,
  undoCanvasHistory,
} from '../../src/services/canvasHistory';
import {
  addEdgesRecorded,
  addNodesRecorded,
  canvasIdOf,
  deleteEdgeRecorded,
  deleteNodesRecorded,
  moveNodeRecorded,
  recordAddedNodes,
  updateNodeRecorded,
} from '../../src/services/canvasMutations';

const CANVAS = 'c1';

function node(id: string, extra: Record<string, unknown> = {}) {
  return { id, canvasId: CANVAS, type: 'text', content: id, x: 0, y: 0, ...extra };
}

describe('canvasHistory', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    resetCanvasHistoryForTests();
  });

  it('建节点后撤销把节点删掉，重做再加回来', async () => {
    await addNodesRecorded(CANVAS, [node('n1')]);
    expect(await db.nodes.count()).toBe(1);
    expect(getCanvasHistoryState(CANVAS)).toEqual({ canUndo: true, canRedo: false });

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.count()).toBe(0);
    expect(getCanvasHistoryState(CANVAS)).toEqual({ canUndo: false, canRedo: true });

    await redoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ id: 'n1', content: 'n1' });
    expect(getCanvasHistoryState(CANVAS)).toEqual({ canUndo: true, canRedo: false });
  });

  it('删节点的撤销把关联连线一并还原', async () => {
    await addNodesRecorded(CANVAS, [node('n1'), node('n2')]);
    await addEdgesRecorded(CANVAS, [{ id: 'e1', canvasId: CANVAS, from: 'n1', to: 'n2' }]);

    await deleteNodesRecorded(CANVAS, ['n1']);
    expect(await db.nodes.count()).toBe(1);
    expect(await db.edges.count()).toBe(0);

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toBeTruthy();
    // 线断了等于没撤销：卡片回来但关系丢了，这是这条断言存在的全部理由
    expect(await db.edges.get('e1')).toMatchObject({ from: 'n1', to: 'n2' });
  });

  it('改字段的撤销只回滚改过的键，其余原样保留', async () => {
    await addNodesRecorded(CANVAS, [node('n1', { content: '旧正文', width: 300 })]);
    await updateNodeRecorded(CANVAS, 'n1', { content: '新正文' });

    expect(await db.nodes.get('n1')).toMatchObject({ content: '新正文', width: 300 });
    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ content: '旧正文', width: 300 });
    await redoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ content: '新正文', width: 300 });
  });

  it('值没变时既不写库也不占一步撤销', async () => {
    await addNodesRecorded(CANVAS, [node('n1', { content: '一样' })]);
    resetCanvasHistoryForTests();

    await updateNodeRecorded(CANVAS, 'n1', { content: '一样' });
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('整组拖拽合并成一步：多张卡各落一次库，撤销一次全回去', async () => {
    await addNodesRecorded(CANVAS, [node('n1'), node('n2'), node('n3')]);
    resetCanvasHistoryForTests();

    await moveNodeRecorded(CANVAS, 'n1', { x: 100, y: 100 });
    await moveNodeRecorded(CANVAS, 'n2', { x: 150, y: 100 });
    await moveNodeRecorded(CANVAS, 'n3', { x: 200, y: 100 });

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toMatchObject({ x: 0, y: 0 });
    expect(await db.nodes.get('n2')).toMatchObject({ x: 0, y: 0 });
    expect(await db.nodes.get('n3')).toMatchObject({ x: 0, y: 0 });
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('同一节点连续拖两次：保留最早的起点与最晚的终点', () => {
    const merged = mergePatches(
      { updatedNodes: [{ id: 'n1', before: { x: 0 }, after: { x: 50 } }] },
      { updatedNodes: [{ id: 'n1', before: { x: 50 }, after: { x: 90 } }] },
    );
    expect(merged.updatedNodes).toEqual([{ id: 'n1', before: { x: 0 }, after: { x: 90 } }]);
  });

  it('撤销后再做新操作会清掉重做栈', async () => {
    await addNodesRecorded(CANVAS, [node('n1')]);
    await undoCanvasHistory(CANVAS);
    expect(getCanvasHistoryState(CANVAS).canRedo).toBe(true);

    await addNodesRecorded(CANVAS, [node('n2')]);
    expect(getCanvasHistoryState(CANVAS).canRedo).toBe(false);
  });

  it('撤销栈按画布隔离', async () => {
    await addNodesRecorded('a', [{ ...node('na'), canvasId: 'a' }]);
    await addNodesRecorded('b', [{ ...node('nb'), canvasId: 'b' }]);

    await undoCanvasHistory('a');
    expect(await db.nodes.get('na')).toBeUndefined();
    expect(await db.nodes.get('nb')).toBeTruthy();
  });

  it('删连线可以撤销回来', async () => {
    await addEdgesRecorded(CANVAS, [{ id: 'e1', canvasId: CANVAS, from: 'n1', to: 'n2' }]);
    await deleteEdgeRecorded(CANVAS, 'e1');
    expect(await db.edges.count()).toBe(0);

    await undoCanvasHistory(CANVAS);
    expect(await db.edges.get('e1')).toBeTruthy();
  });

  it('recordAddedNodes 把逐行写库的一批合成一步', async () => {
    const rows = [node('n1'), node('n2')];
    await db.nodes.bulkAdd(rows);
    recordAddedNodes(CANVAS, rows);

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.count()).toBe(0);
  });

  it('空栈时撤销/重做返回 false 且不炸', async () => {
    expect(await undoCanvasHistory('empty')).toBe(false);
    expect(await redoCanvasHistory('empty')).toBe(false);
  });

  it('栈深超过上限时丢掉最老的一步', async () => {
    for (let i = 0; i < CANVAS_HISTORY_LIMIT + 5; i++) {
      recordCanvasHistory(CANVAS, { addedNodes: [node(`n${i}`)] });
    }
    let steps = 0;
    while (await undoCanvasHistory(CANVAS)) steps++;
    expect(steps).toBe(CANVAS_HISTORY_LIMIT);
  });

  it('清掉画布的栈后不再能撤销', async () => {
    await addNodesRecorded(CANVAS, [node('n1')]);
    clearCanvasHistory(CANVAS);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('状态变化会通知订阅者，且快照引用稳定', async () => {
    let hits = 0;
    subscribeCanvasHistory(() => {
      hits++;
    });
    const before = getCanvasHistoryState(CANVAS);
    await addNodesRecorded(CANVAS, [node('n1')]);
    expect(hits).toBe(1);
    expect(getCanvasHistoryState(CANVAS)).not.toBe(before);
    // 再记一步，canUndo/canRedo 都没变，就不该再惊动订阅者（否则 useSyncExternalStore 会空转）
    await addNodesRecorded(CANVAS, [node('n2')]);
    expect(hits).toBe(1);
  });

  it('行已经不在时跳过字段回写，不会写出半行数据', async () => {
    await addNodesRecorded(CANVAS, [node('n1', { content: '原始' })]);
    await updateNodeRecorded(CANVAS, 'n1', { content: '改过' });
    await db.nodes.delete('n1');

    await undoCanvasHistory(CANVAS);
    expect(await db.nodes.get('n1')).toBeUndefined();
  });

  it('canvasIdOf 把没有 canvasId 的旧行归到 default', () => {
    expect(canvasIdOf({ canvasId: 'x' })).toBe('x');
    expect(canvasIdOf({})).toBe('default');
    expect(canvasIdOf({ canvasId: '' })).toBe('default');
  });
});
