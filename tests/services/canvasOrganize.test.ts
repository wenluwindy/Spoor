import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CanvasNode } from '../../src/db';
import {
  resetCanvasHistoryForTests,
  undoCanvasHistory,
} from '../../src/services/canvasHistory';
import {
  applyOrganizePlanRecorded,
  buildOrganizeCardList,
  parseOrganizeResponse,
  planOrganizeLayout,
} from '../../src/services/canvasOrganize';

const node = (id: string, x = 0, y = 0, content = id): CanvasNode => ({
  id, canvasId: 'c1', type: 'text', content, x, y,
});

describe('parseOrganizeResponse', () => {
  const valid = new Set(['a', 'b', 'c']);

  it('剥掉代码栅栏与客套话后解析', () => {
    const groups = parseOrganizeResponse(
      '好的，以下是分组：\n```json\n{"groups":[{"title":"想法","nodeIds":["a","b"]}]}\n```',
      valid,
    );
    expect(groups).toEqual([{ title: '想法', nodeIds: ['a', 'b'] }]);
  });

  it('幻觉 id 滤掉、重复出现的卡第一组赢、空组丢弃', () => {
    const groups = parseOrganizeResponse(
      JSON.stringify({
        groups: [
          { title: '一', nodeIds: ['a', 'ghost'] },
          { title: '二', nodeIds: ['a', 'b'] },
          { title: '全是幻觉', nodeIds: ['nope'] },
        ],
      }),
      valid,
    );
    expect(groups).toEqual([
      { title: '一', nodeIds: ['a'] },
      { title: '二', nodeIds: ['b'] },
    ]);
  });

  it('解析不动（坏 JSON / 无 groups / 全空）返回 null', () => {
    expect(parseOrganizeResponse('不是 JSON', valid)).toBeNull();
    expect(parseOrganizeResponse('{"answer": 42}', valid)).toBeNull();
    expect(parseOrganizeResponse('{"groups":[{"title":"x","nodeIds":["ghost"]}]}', valid)).toBeNull();
  });
});

describe('planOrganizeLayout', () => {
  it('每组一个框：卡片进网格、框包住网格、组横向排开', () => {
    const nodes = [node('a', 500, 500), node('b', 900, 100), node('c', 0, 0)];
    const plan = planOrganizeLayout(
      'c1',
      [
        { title: '甲', nodeIds: ['a', 'b'] },
        { title: '乙', nodeIds: ['c'] },
      ],
      nodes,
      (() => {
        let i = 0;
        return () => `frame-${++i}`;
      })(),
    );

    expect(plan.frames).toHaveLength(2);
    expect(plan.frames[0]).toMatchObject({ type: 'frame', content: '甲', x: 0, y: 0 });
    // 第二个框在第一个框右侧
    expect(plan.frames[1].x).toBeGreaterThan(plan.frames[0].x + (plan.frames[0].width ?? 0));

    // 组内成员都落在自己框的内部
    const [f1] = plan.frames;
    for (const id of ['a', 'b']) {
      const move = plan.moves.find((m) => m.id === id)!;
      expect(move.after.x).toBeGreaterThan(f1.x);
      expect(move.after.x).toBeLessThan(f1.x + (f1.width ?? 0));
      expect(move.after.y).toBeGreaterThan(f1.y);
      expect(move.after.y).toBeLessThan(f1.y + (f1.height ?? 0));
    }
  });

  it('move 的 before 如实记录原位置（撤销要按它回滚）', () => {
    const nodes = [node('a', 123, 456)];
    const plan = planOrganizeLayout('c1', [{ title: '组', nodeIds: ['a'] }], nodes);
    expect(plan.moves[0].before).toEqual({ x: 123, y: 456 });
    expect(plan.moves[0].after).not.toEqual(plan.moves[0].before);
  });
});

describe('applyOrganizePlanRecorded', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    resetCanvasHistoryForTests();
  });

  it('框与位移一次落库，一步撤销整体回滚', async () => {
    await db.nodes.bulkAdd([node('a', 500, 500), node('b', 900, 100), node('c', 0, 300)]);
    const nodes = await db.nodes.toArray();
    const plan = planOrganizeLayout(
      'c1',
      [
        { title: '甲', nodeIds: ['a', 'b'] },
        { title: '乙', nodeIds: ['c'] },
      ],
      nodes,
    );
    await applyOrganizePlanRecorded(plan);

    expect(await db.nodes.count()).toBe(3 + 2);
    const movedA = await db.nodes.get('a');
    expect(movedA?.x).not.toBe(500);

    await undoCanvasHistory('c1');
    expect(await db.nodes.count()).toBe(3);
    expect(await db.nodes.get('a')).toMatchObject({ x: 500, y: 500 });
    expect(await db.nodes.get('c')).toMatchObject({ x: 0, y: 300 });
  });
});

describe('buildOrganizeCardList', () => {
  it('清单带 id 与截断摘要，空文本标注为空', () => {
    const list = buildOrganizeCardList(
      [node('a', 0, 0, 'x'.repeat(500)), node('b', 0, 0, '')],
      (n) => n.content ?? '',
    );
    expect(list).toContain('id: a');
    expect(list).toContain('id: b');
    expect(list).toContain('(空)');
    expect(list.length).toBeLessThan(400);
  });
});
