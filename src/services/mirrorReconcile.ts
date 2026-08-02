/**
 * 启动对账（0.5.0「笔记落文件」的合并半边）。
 *
 * 启动时把 `SpoorData/notes/` 里的镜像文件与库比对：
 * - 库里**没有**的画布 → 整体导入（另一台机器新建的画布，或本机 IndexedDB 丢了后恢复）；
 * - 文件的 `savedAt` 与记账表一致 → 就是我们自己写的那份，无事；
 * - 不一致 → 文件被外部改过（典型：另一台机器经网盘同步写入）→ **并集 + 字段级 LWW**：
 *   节点按 id 配对，两边都有的取 `updatedAt` 较新的一侧；只在一边的一律保留。
 *
 * 刻意的边界（写进文档也写进这里）：**删除不跨设备传播**。没有墓碑记录时，
 * "只在一边"分不清是那边新增还是这边删除——把别人的新卡当成我删过的卡而丢弃，
 * 比让删过的卡回来一张严重得多。宁可多，不可丢。
 */

import type { AiTurn, Canvas, CanvasNode, Edge, MirrorStateRow } from '../db';
import { mirrorFileToRows, type CanvasMirrorFile } from './canvasMirror';

export interface CanvasDbState {
  canvas?: Canvas;
  nodes: CanvasNode[];
  edges: Edge[];
  aiTurns: AiTurn[];
  mirrorState?: MirrorStateRow;
}

export interface CanvasMergePlan {
  canvasId: string;
  kind: 'import-new' | 'in-sync' | 'merge';
  /** merge/import 时要 bulkPut 的行（已带 canvasId）。 */
  nodeUpserts: CanvasNode[];
  edgeUpserts: Edge[];
  aiTurnUpserts: AiTurn[];
  /** 画布行本身的新建/改名。 */
  canvasUpsert?: Canvas;
  /** 应用后记账表要写成的值（revision 取两侧较大者，lastSavedAt 取文件值）。 */
  nextState: MirrorStateRow;
  /** 给确认对话框看的统计。 */
  stats: { added: number; updated: number };
}

export function planCanvasMerge(file: CanvasMirrorFile, dbState: CanvasDbState): CanvasMergePlan {
  const meta = file.spoorMeta;
  const canvasId = meta.canvasId;
  const fileRows = mirrorFileToRows(file);
  const nextState: MirrorStateRow = {
    id: canvasId,
    revision: Math.max(meta.revision, dbState.mirrorState?.revision ?? 0),
    lastSavedAt: meta.savedAt,
  };

  if (!dbState.canvas) {
    return {
      canvasId,
      kind: 'import-new',
      nodeUpserts: fileRows.nodes,
      edgeUpserts: fileRows.edges,
      aiTurnUpserts: fileRows.aiTurns,
      canvasUpsert: {
        id: canvasId,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      },
      nextState,
      stats: { added: fileRows.nodes.length, updated: 0 },
    };
  }

  if (dbState.mirrorState && dbState.mirrorState.lastSavedAt === meta.savedAt) {
    return {
      canvasId,
      kind: 'in-sync',
      nodeUpserts: [],
      edgeUpserts: [],
      aiTurnUpserts: [],
      nextState,
      stats: { added: 0, updated: 0 },
    };
  }

  // 外部改过：并集 + 节点级 LWW
  const dbNodesById = new Map(dbState.nodes.map((n) => [n.id, n]));
  const nodeUpserts: CanvasNode[] = [];
  let added = 0;
  let updated = 0;
  for (const fileNode of fileRows.nodes) {
    const mine = dbNodesById.get(fileNode.id);
    if (!mine) {
      nodeUpserts.push(fileNode);
      added += 1;
      continue;
    }
    // 相等取本机：别为没有差异的行白写一次库
    if ((fileNode.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
      nodeUpserts.push(fileNode);
      updated += 1;
    }
  }

  const dbEdgeIds = new Set(dbState.edges.map((e) => e.id));
  const knownNodeIds = new Set([...dbNodesById.keys(), ...fileRows.nodes.map((n) => n.id)]);
  const edgeUpserts = fileRows.edges.filter(
    (e) => !dbEdgeIds.has(e.id) && knownNodeIds.has(e.from) && knownNodeIds.has(e.to),
  );

  const dbTurnIds = new Set(dbState.aiTurns.map((t) => t.id));
  const aiTurnUpserts = fileRows.aiTurns.filter((t) => !dbTurnIds.has(t.id));

  const canvasUpsert =
    meta.updatedAt > dbState.canvas.updatedAt && meta.name !== dbState.canvas.name
      ? { ...dbState.canvas, name: meta.name, updatedAt: meta.updatedAt }
      : undefined;

  return {
    canvasId,
    kind: 'merge',
    nodeUpserts,
    edgeUpserts,
    aiTurnUpserts,
    canvasUpsert,
    nextState,
    stats: { added, updated },
  };
}

/** 合并计划有没有实际要写的东西（merge 也可能算完发现两边等价）。 */
export function planHasChanges(plan: CanvasMergePlan): boolean {
  return (
    plan.kind === 'import-new' ||
    plan.nodeUpserts.length > 0 ||
    plan.edgeUpserts.length > 0 ||
    plan.aiTurnUpserts.length > 0 ||
    plan.canvasUpsert !== undefined
  );
}

// ── 全局表（长文/人设/模板）──

export interface GlobalMergePlan<T extends { id: string }> {
  scope: 'articles' | 'agents' | 'templates';
  /** 只补文件里有而库里没有的行——全局表没有行级时间戳，本机数据一律优先。 */
  upserts: T[];
  nextState: MirrorStateRow;
}

export function planGlobalMerge<T extends { id: string }>(
  scope: 'articles' | 'agents' | 'templates',
  fileRows: T[],
  fileSavedAt: number,
  fileRevision: number,
  dbRows: { id: string }[],
  mirrorState?: MirrorStateRow,
): GlobalMergePlan<T> | null {
  if (mirrorState && mirrorState.lastSavedAt === fileSavedAt) return null;
  const known = new Set(dbRows.map((r) => r.id));
  return {
    scope,
    upserts: fileRows.filter((r) => r && typeof r.id === 'string' && !known.has(r.id)),
    nextState: {
      id: scope,
      revision: Math.max(fileRevision, mirrorState?.revision ?? 0),
      lastSavedAt: fileSavedAt,
    },
  };
}
