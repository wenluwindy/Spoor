import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  getCanvasHistoryState,
  resetCanvasHistoryForTests,
  undoCanvasHistory,
} from '../../src/services/canvasHistory';
import { deleteTag, renameTag } from '../../src/services/tagOps';
import { getActiveTags, resetTagFilterForTests, toggleTag } from '../../src/services/tagFilter';

const CANVAS = 'c1';

function node(id: string, tags?: string[], canvasId = CANVAS) {
  return { id, canvasId, type: 'text', content: id, x: 0, y: 0, tags };
}

describe('tagOps', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    resetCanvasHistoryForTests();
    resetTagFilterForTests();
  });

  it('renameTag 批量改本画布所有带该标签的节点，别的画布不动', async () => {
    await db.nodes.bulkAdd([
      node('n1', ['旧', '别的']),
      node('n2', ['旧']),
      node('n3', ['无关']),
      node('other', ['旧'], 'c2'),
    ]);
    resetCanvasHistoryForTests();

    const changed = await renameTag(CANVAS, '旧', '新');

    expect(changed).toBe(2);
    expect((await db.nodes.get('n1'))?.tags).toEqual(['新', '别的']);
    expect((await db.nodes.get('n2'))?.tags).toEqual(['新']);
    expect((await db.nodes.get('n3'))?.tags).toEqual(['无关']);
    // 另一张画布上的同名标签保持原样
    expect((await db.nodes.get('other'))?.tags).toEqual(['旧']);
  });

  it('合并 = 重命名到已存在的标签，且去重不留 ["a","a"]', async () => {
    await db.nodes.bulkAdd([node('n1', ['甲', '乙']), node('n2', ['甲'])]);
    resetCanvasHistoryForTests();

    await renameTag(CANVAS, '甲', '乙');

    expect((await db.nodes.get('n1'))?.tags).toEqual(['乙']);
    expect((await db.nodes.get('n2'))?.tags).toEqual(['乙']);
  });

  it('整批算一步撤销：Ctrl+Z 一次全部回来', async () => {
    await db.nodes.bulkAdd([node('n1', ['旧']), node('n2', ['旧', '乙']), node('n3', ['旧'])]);
    resetCanvasHistoryForTests();

    await renameTag(CANVAS, '旧', '新');
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(true);

    await undoCanvasHistory(CANVAS);
    expect((await db.nodes.get('n1'))?.tags).toEqual(['旧']);
    expect((await db.nodes.get('n2'))?.tags).toEqual(['旧', '乙']);
    expect((await db.nodes.get('n3'))?.tags).toEqual(['旧']);
    // 只占了一格撤销栈：一步之后就没有可撤销的了
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('deleteTag 摘掉标签，摘光的节点 tags 置回 undefined；同样一步可撤销', async () => {
    await db.nodes.bulkAdd([node('n1', ['废弃']), node('n2', ['废弃', '保留'])]);
    resetCanvasHistoryForTests();

    const changed = await deleteTag(CANVAS, '废弃');

    expect(changed).toBe(2);
    expect((await db.nodes.get('n1'))?.tags).toBeUndefined();
    expect((await db.nodes.get('n2'))?.tags).toEqual(['保留']);

    await undoCanvasHistory(CANVAS);
    expect((await db.nodes.get('n1'))?.tags).toEqual(['废弃']);
    expect((await db.nodes.get('n2'))?.tags).toEqual(['废弃', '保留']);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('改名为空 / 同名 / 无命中节点时不写库也不入撤销栈', async () => {
    await db.nodes.add(node('n1', ['甲']));
    resetCanvasHistoryForTests();

    expect(await renameTag(CANVAS, '甲', '  ')).toBe(0);
    expect(await renameTag(CANVAS, '甲', '甲')).toBe(0);
    expect(await renameTag(CANVAS, '不存在', '新')).toBe(0);
    expect(await deleteTag(CANVAS, '不存在')).toBe(0);

    expect((await db.nodes.get('n1'))?.tags).toEqual(['甲']);
    expect(getCanvasHistoryState(CANVAS).canUndo).toBe(false);
  });

  it('正在按旧名筛选时，改名 / 删除会同步筛选状态，不残留幽灵标签', async () => {
    await db.nodes.bulkAdd([node('n1', ['旧']), node('n2', ['临时'])]);
    resetCanvasHistoryForTests();

    toggleTag('旧');
    await renameTag(CANVAS, '旧', '新');
    expect(getActiveTags().has('新')).toBe(true);
    expect(getActiveTags().has('旧')).toBe(false);

    toggleTag('临时');
    await deleteTag(CANVAS, '临时');
    expect(getActiveTags().has('临时')).toBe(false);
    expect(getActiveTags().has('新')).toBe(true);
  });
});
