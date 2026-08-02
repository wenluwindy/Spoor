import { describe, expect, it } from 'vitest';
import type { Canvas, CanvasNode } from '../../src/db';
import { buildCanvasMirrorContent, parseCanvasMirrorFile } from '../../src/services/canvasMirror';
import { planCanvasMerge, planGlobalMerge, planHasChanges } from '../../src/services/mirrorReconcile';

const CANVAS: Canvas = { id: 'c1', name: '本机名', createdAt: 100, updatedAt: 500 };

function fileWith(params: {
  nodes: CanvasNode[];
  savedAt: number;
  revision?: number;
  name?: string;
  canvasUpdatedAt?: number;
}) {
  return parseCanvasMirrorFile(
    buildCanvasMirrorContent({
      canvas: { ...CANVAS, name: params.name ?? CANVAS.name, updatedAt: params.canvasUpdatedAt ?? CANVAS.updatedAt },
      nodes: params.nodes,
      edges: [],
      aiTurns: [],
      revision: params.revision ?? 1,
      savedAt: params.savedAt,
    }),
  )!;
}

const node = (id: string, updatedAt: number, content = id): CanvasNode => ({
  id, canvasId: 'c1', type: 'text', content, x: 0, y: 0, updatedAt,
});

describe('planCanvasMerge', () => {
  it('库里没有的画布整体导入（另一台机器新建 / IndexedDB 丢失恢复）', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [node('a', 1)], savedAt: 10 }), {
      canvas: undefined, nodes: [], edges: [], aiTurns: [], mirrorState: undefined,
    });
    expect(plan.kind).toBe('import-new');
    expect(plan.nodeUpserts).toHaveLength(1);
    expect(plan.canvasUpsert?.id).toBe('c1');
    expect(plan.nextState).toMatchObject({ lastSavedAt: 10 });
  });

  it('savedAt 与记账一致 → in-sync，一行不写', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [node('a', 1)], savedAt: 10 }), {
      canvas: CANVAS, nodes: [node('a', 1)], edges: [], aiTurns: [],
      mirrorState: { id: 'c1', revision: 1, lastSavedAt: 10 },
    });
    expect(plan.kind).toBe('in-sync');
    expect(planHasChanges(plan)).toBe(false);
  });

  it('外部改过：文件新的字段级胜出，本机新的原样保留', () => {
    const plan = planCanvasMerge(
      fileWith({ nodes: [node('a', 200, '文件版A'), node('b', 50, '文件版B')], savedAt: 99 }),
      {
        canvas: CANVAS,
        nodes: [node('a', 100, '本机版A'), node('b', 300, '本机版B')],
        edges: [], aiTurns: [],
        mirrorState: { id: 'c1', revision: 1, lastSavedAt: 10 },
      },
    );
    expect(plan.kind).toBe('merge');
    // a：文件 updatedAt 200 > 本机 100 → 文件版进库
    expect(plan.nodeUpserts.map((n) => n.id)).toEqual(['a']);
    expect(plan.nodeUpserts[0].content).toBe('文件版A');
    // b：本机 300 > 文件 50 → 不动
    expect(plan.stats).toEqual({ added: 0, updated: 1 });
  });

  it('并集语义：只在文件里的节点补进来，只在本机的不删（删除不跨设备传播）', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [node('file-only', 5)], savedAt: 99 }), {
      canvas: CANVAS, nodes: [node('db-only', 5)], edges: [], aiTurns: [],
      mirrorState: { id: 'c1', revision: 1, lastSavedAt: 10 },
    });
    expect(plan.nodeUpserts.map((n) => n.id)).toEqual(['file-only']);
    // db-only 不出现在任何删除指令里——计划里根本没有删除通道
    expect(plan.stats.added).toBe(1);
  });

  it('updatedAt 相等取本机（不为无差异的行白写库）', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [node('a', 100, '文件')], savedAt: 99 }), {
      canvas: CANVAS, nodes: [node('a', 100, '本机')], edges: [], aiTurns: [],
      mirrorState: { id: 'c1', revision: 1, lastSavedAt: 10 },
    });
    expect(plan.nodeUpserts).toHaveLength(0);
  });

  it('没有记账行（重装后首次对账）也走合并而不是误判 in-sync', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [node('a', 200, '文件版')], savedAt: 99 }), {
      canvas: CANVAS, nodes: [node('a', 100, '本机版')], edges: [], aiTurns: [], mirrorState: undefined,
    });
    expect(plan.kind).toBe('merge');
    expect(plan.nodeUpserts[0].content).toBe('文件版');
  });

  it('画布改名：文件侧 updatedAt 更新才接受', () => {
    const renamed = planCanvasMerge(
      fileWith({ nodes: [], savedAt: 99, name: '远端新名', canvasUpdatedAt: 900 }),
      { canvas: CANVAS, nodes: [], edges: [], aiTurns: [], mirrorState: { id: 'c1', revision: 1, lastSavedAt: 1 } },
    );
    expect(renamed.canvasUpsert?.name).toBe('远端新名');

    const stale = planCanvasMerge(
      fileWith({ nodes: [], savedAt: 99, name: '远端旧名', canvasUpdatedAt: 100 }),
      { canvas: CANVAS, nodes: [], edges: [], aiTurns: [], mirrorState: { id: 'c1', revision: 1, lastSavedAt: 1 } },
    );
    expect(stale.canvasUpsert).toBeUndefined();
  });

  it('revision 取两侧较大者（合并后本机继续往上数不回退）', () => {
    const plan = planCanvasMerge(fileWith({ nodes: [], savedAt: 99, revision: 7 }), {
      canvas: CANVAS, nodes: [], edges: [], aiTurns: [],
      mirrorState: { id: 'c1', revision: 12, lastSavedAt: 1 },
    });
    expect(plan.nextState.revision).toBe(12);
  });
});

describe('planGlobalMerge', () => {
  it('savedAt 一致返回 null；不一致只补文件独有的行', () => {
    expect(
      planGlobalMerge('articles', [{ id: 'a1' }], 10, 1, [], { id: 'articles', revision: 1, lastSavedAt: 10 }),
    ).toBeNull();

    const plan = planGlobalMerge(
      'articles',
      [{ id: 'a1' }, { id: 'a2' }],
      99, 2,
      [{ id: 'a1' }],
      { id: 'articles', revision: 1, lastSavedAt: 10 },
    )!;
    expect(plan.upserts.map((r) => r.id)).toEqual(['a2']);
    expect(plan.nextState).toMatchObject({ lastSavedAt: 99, revision: 2 });
  });
});
