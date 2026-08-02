/**
 * 画布撤销 / 重做栈。
 *
 * 记录的是**数据补丁**而不是命令闭包：一条记录就是「这次操作加了哪些行、删了哪些行、
 * 改了哪些字段的哪些值」。这样撤销与重做是同一段代码的两个方向，不必为每种操作
 * 手写一遍逆操作，将来加节点类型也不用回来改这里。
 *
 * 三条边界，都是刻意的：
 *
 * 1. **按画布隔离**。栈存在 `Map<canvasId, …>` 里，切到另一张画布再按 Ctrl+Z，
 *    撤的是那张画布自己的上一步，而不是你上一张画布干的事。
 * 2. **只记用户的结构性编辑**。AI 流式写入、生图结果落盘不进栈——流式期间每几十毫秒
 *    写一次 `content`，逐条入栈会把栈冲爆，而"撤销一次 AI 生成"的正确语义是删掉整张卡，
 *    那由创建那张卡的记录负责。写库路径见 `canvasMutations`：入栈是**显式选择**，
 *    直接调 `db.nodes.*` 的地方一律不记。
 * 3. **串行执行**。undo/redo 落库后 UI 靠 `useLiveQuery` 回流，快速连按会让两次
 *    撤销的写库交错。这里用一条 promise 链把它们排队。
 */

import { db, type CanvasNode, type Edge } from '../db';

/** 单个节点的字段级变更；只装被改动的字段，不装整行。 */
export interface CanvasNodeFieldChange {
  id: string;
  before: Partial<CanvasNode>;
  after: Partial<CanvasNode>;
}

export interface CanvasHistoryPatch {
  /** 本次新建的行。撤销 = 删掉；重做 = 加回来。 */
  addedNodes?: CanvasNode[];
  addedEdges?: Edge[];
  /** 本次删掉的行（删之前的完整快照）。撤销 = 原样加回来；重做 = 再删一次。 */
  removedNodes?: CanvasNode[];
  removedEdges?: Edge[];
  /** 本次改动的字段。撤销 = 写回 before；重做 = 写回 after。 */
  updatedNodes?: CanvasNodeFieldChange[];
}

interface HistoryEntry {
  patch: CanvasHistoryPatch;
  /** 相邻同键记录在时间窗内会并成一条，用于整组拖拽（每张卡各落一次库）。 */
  coalesceKey?: string;
  at: number;
}

interface CanvasStacks {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** 栈深上限。超过就从底部丢——撤销一百步之外的操作没有实际需求，内存倒是会一直涨。 */
export const CANVAS_HISTORY_LIMIT = 100;

/** 合并窗口：整组拖拽里每张卡各自落库，全都发生在这个窗口内。 */
export const CANVAS_HISTORY_COALESCE_MS = 400;

const stacks = new Map<string, CanvasStacks>();
const listeners = new Set<() => void>();

export interface CanvasHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

const EMPTY_STATE: CanvasHistoryState = { canUndo: false, canRedo: false };

/**
 * `useSyncExternalStore` 要求同一状态返回同一引用，否则每次渲染都判定为变化并无限重渲。
 * 这里按画布缓存快照对象，只有 canUndo/canRedo 真变了才换新对象。
 */
const snapshots = new Map<string, CanvasHistoryState>();

function stacksOf(canvasId: string): CanvasStacks {
  let s = stacks.get(canvasId);
  if (!s) {
    s = { undo: [], redo: [] };
    stacks.set(canvasId, s);
  }
  return s;
}

function notify(canvasId: string): void {
  const s = stacks.get(canvasId);
  const next: CanvasHistoryState = {
    canUndo: (s?.undo.length ?? 0) > 0,
    canRedo: (s?.redo.length ?? 0) > 0,
  };
  const prev = snapshots.get(canvasId) ?? EMPTY_STATE;
  if (prev.canUndo === next.canUndo && prev.canRedo === next.canRedo) return;
  snapshots.set(canvasId, next);
  listeners.forEach((fn) => fn());
}

export function getCanvasHistoryState(canvasId: string): CanvasHistoryState {
  return snapshots.get(canvasId) ?? EMPTY_STATE;
}

export function subscribeCanvasHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 补丁是不是什么都没干——空补丁不该占一格撤销。 */
export function isEmptyPatch(patch: CanvasHistoryPatch): boolean {
  return (
    (patch.addedNodes?.length ?? 0) === 0 &&
    (patch.addedEdges?.length ?? 0) === 0 &&
    (patch.removedNodes?.length ?? 0) === 0 &&
    (patch.removedEdges?.length ?? 0) === 0 &&
    (patch.updatedNodes?.length ?? 0) === 0
  );
}

/**
 * 把 `next` 并进 `base`。
 *
 * 同一个节点被改了两次时，保留**最早的 before 与最晚的 after**——这正是
 * 「整组拖拽算一步」想要的语义：撤销回到拖拽开始前，而不是回到中间某一帧。
 */
export function mergePatches(base: CanvasHistoryPatch, next: CanvasHistoryPatch): CanvasHistoryPatch {
  const updated = [...(base.updatedNodes ?? [])];
  const indexById = new Map(updated.map((u, i) => [u.id, i]));
  for (const change of next.updatedNodes ?? []) {
    const at = indexById.get(change.id);
    if (at === undefined) {
      indexById.set(change.id, updated.length);
      updated.push(change);
      continue;
    }
    updated[at] = {
      id: change.id,
      before: { ...change.before, ...updated[at].before },
      after: { ...updated[at].after, ...change.after },
    };
  }

  return {
    addedNodes: [...(base.addedNodes ?? []), ...(next.addedNodes ?? [])],
    addedEdges: [...(base.addedEdges ?? []), ...(next.addedEdges ?? [])],
    removedNodes: [...(base.removedNodes ?? []), ...(next.removedNodes ?? [])],
    removedEdges: [...(base.removedEdges ?? []), ...(next.removedEdges ?? [])],
    updatedNodes: updated,
  };
}

export interface RecordOptions {
  /** 相同键的相邻记录在 `CANVAS_HISTORY_COALESCE_MS` 内合并成一条。 */
  coalesceKey?: string;
}

/**
 * 记一步。任何新操作都会清掉重做栈——分支历史没有意义，也没人指望它。
 */
export function recordCanvasHistory(
  canvasId: string,
  patch: CanvasHistoryPatch,
  options: RecordOptions = {},
): void {
  if (isEmptyPatch(patch)) return;
  const s = stacksOf(canvasId);
  const now = Date.now();
  const top = s.undo[s.undo.length - 1];

  if (
    options.coalesceKey &&
    top &&
    top.coalesceKey === options.coalesceKey &&
    now - top.at <= CANVAS_HISTORY_COALESCE_MS
  ) {
    top.patch = mergePatches(top.patch, patch);
    top.at = now;
    s.redo.length = 0;
    notify(canvasId);
    return;
  }

  s.undo.push({ patch, coalesceKey: options.coalesceKey, at: now });
  if (s.undo.length > CANVAS_HISTORY_LIMIT) s.undo.shift();
  s.redo.length = 0;
  notify(canvasId);
}

async function applyPatch(patch: CanvasHistoryPatch, direction: 'undo' | 'redo'): Promise<void> {
  const undoing = direction === 'undo';

  // 先删后加：同一步里既删又加时，先腾出位置再放回，避免主键撞车。
  const nodesToDelete = undoing ? patch.addedNodes : patch.removedNodes;
  const edgesToDelete = undoing ? patch.addedEdges : patch.removedEdges;
  const nodesToAdd = undoing ? patch.removedNodes : patch.addedNodes;
  const edgesToAdd = undoing ? patch.removedEdges : patch.addedEdges;

  // 一条补丁要么整个生效要么整个不生效：撤销撤到一半留下的状态既不是 before 也不是 after，
  // 用户没有任何手段回到正确的一侧。
  await db.transaction('rw', db.nodes, db.edges, async () => {
    if (edgesToDelete?.length) await db.edges.bulkDelete(edgesToDelete.map((e) => e.id));
    if (nodesToDelete?.length) await db.nodes.bulkDelete(nodesToDelete.map((n) => n.id));
    // bulkPut 而非 bulkAdd：重复撤销/重做时不该因为行已存在就整批失败。
    if (nodesToAdd?.length) await db.nodes.bulkPut(nodesToAdd);
    if (edgesToAdd?.length) await db.edges.bulkPut(edgesToAdd);

    for (const change of patch.updatedNodes ?? []) {
      const fields = undoing ? change.before : change.after;
      // 行已经不在了（比如被后续操作删掉又撤到这里）就跳过，别把半行数据写回去。
      const exists = await db.nodes.get(change.id);
      if (!exists) continue;
      await db.nodes.update(change.id, fields);
    }
  });
}

/** 串行闸门：undo/redo 一次只跑一个，避免两次写库与 live query 回流交错。 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** 撤销一步。栈空时返回 false。 */
export function undoCanvasHistory(canvasId: string): Promise<boolean> {
  return enqueue(async () => {
    const s = stacksOf(canvasId);
    const entry = s.undo.pop();
    if (!entry) return false;
    await applyPatch(entry.patch, 'undo');
    s.redo.push(entry);
    notify(canvasId);
    return true;
  });
}

/** 重做一步。栈空时返回 false。 */
export function redoCanvasHistory(canvasId: string): Promise<boolean> {
  return enqueue(async () => {
    const s = stacksOf(canvasId);
    const entry = s.redo.pop();
    if (!entry) return false;
    await applyPatch(entry.patch, 'redo');
    s.undo.push(entry);
    notify(canvasId);
    return true;
  });
}

/** 删画布时把它的栈一起清掉，免得指向已经不存在的行。 */
export function clearCanvasHistory(canvasId: string): void {
  if (!stacks.has(canvasId)) return;
  stacks.delete(canvasId);
  notify(canvasId);
}

/** 仅供测试。 */
export function resetCanvasHistoryForTests(): void {
  stacks.clear();
  snapshots.clear();
  listeners.clear();
  queue = Promise.resolve();
}
