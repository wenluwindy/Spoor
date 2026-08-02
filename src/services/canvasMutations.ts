/**
 * 可撤销的节点 / 连线写操作。
 *
 * 这里是**唯一**同时做「写库」和「入撤销栈」两件事的地方。规则很直接：
 * 用户在画布上亲手做的结构性编辑走这里，AI 流式写入、生图落盘、数据迁移这类
 * 不该被 Ctrl+Z 撤掉的写入继续直接调 `db.*`。入栈是显式选择，不是拦截。
 *
 * 每个函数都遵循同一节奏：**先读出旧值 → 再写库 → 最后把补丁交给 `canvasHistory`**。
 * 顺序不能反——写完再读就拿不到 before 了。
 */

import { db, type CanvasNode, type Edge } from '../db';
import { recordCanvasHistory } from './canvasHistory';

/** 拖拽落库的合并键：整组拖拽里每张卡各落一次库，靠它并成一步。 */
const MOVE_COALESCE_KEY = 'move';

/**
 * 行归属哪张画布。旧数据里没有 `canvasId` 的一律算 `'default'`，
 * 与 `App` 的 `useLiveQuery` 过滤、`canvasRepository.belongsToCanvas` 保持同一套判断。
 */
export function canvasIdOf(row: { canvasId?: string }): string {
  return row.canvasId || 'default';
}

/** 建节点。传进来的行必须已经带好 id 与 canvasId。 */
export async function addNodesRecorded(canvasId: string, rows: CanvasNode[]): Promise<string[]> {
  if (rows.length === 0) return [];
  await db.nodes.bulkAdd(rows);
  recordCanvasHistory(canvasId, { addedNodes: rows });
  return rows.map((r) => r.id);
}

/**
 * 只补记一步，不写库。
 *
 * 给「必须逐行写库」的调用方用：导入多个文件时每处理完一个就让卡片先出现，
 * 攒到最后再一次 bulkAdd 的话，选了五个大文件就会盯着空画布等半天。
 * 逐行写完之后调这里，五张卡仍然算一步撤销。
 */
export function recordAddedNodes(canvasId: string, rows: CanvasNode[]): void {
  if (rows.length === 0) return;
  recordCanvasHistory(canvasId, { addedNodes: rows });
}

/** 建连线。 */
export async function addEdgesRecorded(canvasId: string, rows: Edge[]): Promise<void> {
  if (rows.length === 0) return;
  await db.edges.bulkAdd(rows);
  recordCanvasHistory(canvasId, { addedEdges: rows });
}

/**
 * 节点与连线一起建，算**一步**撤销。
 *
 * 粘贴一批带连线的卡片时用它。分开调两个函数会记成两步，撤销一次只撤掉线、
 * 卡片还留在画布上——那不是用户按 Ctrl+Z 时想要的结果。
 */
export async function addNodesAndEdgesRecorded(
  canvasId: string,
  nodes: CanvasNode[],
  edges: Edge[],
): Promise<string[]> {
  if (nodes.length === 0 && edges.length === 0) return [];
  // 事务包住两张表：节点写成了、边写炸了会留下"有卡没线"的半成品，
  // 而补丁已经把边记进去，撤销时就会去删不存在的行。要么全成，要么全无。
  await db.transaction('rw', db.nodes, db.edges, async () => {
    if (nodes.length > 0) await db.nodes.bulkAdd(nodes);
    if (edges.length > 0) await db.edges.bulkAdd(edges);
  });
  recordCanvasHistory(canvasId, { addedNodes: nodes, addedEdges: edges });
  return nodes.map((n) => n.id);
}

/**
 * 删节点，连同它们的全部关联边。
 *
 * 边必须一起记进补丁：只记节点的话，撤销后卡片是回来了，线却全断了——
 * 对一个靠连线表达关系的画布来说，那和没撤销差不多。
 */
export async function deleteNodesRecorded(canvasId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const removedNodes = await db.nodes.bulkGet(ids);
  const existing = removedNodes.filter((n): n is CanvasNode => Boolean(n));
  if (existing.length === 0) return;

  const removedEdges = await db.edges.filter((e) => idSet.has(e.from) || idSet.has(e.to)).toArray();

  // 同一事务里删边再删点：中途失败时整体回滚，不会出现"点没了、悬空边还在"。
  await db.transaction('rw', db.nodes, db.edges, async () => {
    if (removedEdges.length > 0) await db.edges.bulkDelete(removedEdges.map((e) => e.id));
    await db.nodes.bulkDelete(existing.map((n) => n.id));
  });

  recordCanvasHistory(canvasId, { removedNodes: existing, removedEdges });
}

/** 删一条连线。 */
export async function deleteEdgeRecorded(canvasId: string, edgeId: string): Promise<void> {
  const row = await db.edges.get(edgeId);
  if (!row) return;
  await db.edges.delete(edgeId);
  recordCanvasHistory(canvasId, { removedEdges: [row] });
}

/**
 * 改节点字段。`before` 只取 `patch` 里出现过的那几个键——
 * 存整行会让一次改标题的记录拖着整段正文和全部生图历史。
 */
export async function updateNodeRecorded(
  canvasId: string,
  id: string,
  patch: Partial<CanvasNode>,
  options: { coalesceKey?: string } = {},
): Promise<void> {
  const row = await db.nodes.get(id);
  if (!row) return;

  const before: Partial<CanvasNode> = {};
  const after: Partial<CanvasNode> = {};
  for (const key of Object.keys(patch) as (keyof CanvasNode)[]) {
    const nextValue = patch[key];
    if (Object.is(row[key], nextValue)) continue;
    (before as Record<string, unknown>)[key] = row[key];
    (after as Record<string, unknown>)[key] = nextValue;
  }
  // 值没变就不写库也不入栈：拖了一下又放回原位、点进编辑没改字都算不上一步。
  if (Object.keys(after).length === 0) return;

  await db.nodes.update(id, after);
  recordCanvasHistory(canvasId, { updatedNodes: [{ id, before, after }] }, options);
}

/** 拖拽落库。整组拖拽的多次调用会被合并成一步。 */
export function moveNodeRecorded(
  canvasId: string,
  id: string,
  pos: { x: number; y: number },
): Promise<void> {
  return updateNodeRecorded(canvasId, id, pos, { coalesceKey: MOVE_COALESCE_KEY });
}

/** 拉伸落库。按节点分键，免得两张卡的拉伸被并成一步。 */
export function resizeNodeRecorded(
  canvasId: string,
  id: string,
  size: { width?: number; height?: number },
): Promise<void> {
  return updateNodeRecorded(canvasId, id, size, { coalesceKey: `resize:${id}` });
}
