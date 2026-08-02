/**
 * 笔记的文件镜像（0.5.0「笔记落文件」的序列化半边）。
 *
 * 每张画布一个 `SpoorData/notes/<canvasId>.canvas`：**顶层就是合法的 JSON Canvas**
 * （nodes/edges），Obsidian 直接打得开；Spoor 的额外信息放在它会忽略的
 * `spoorMeta`（画布元数据 + 修订号）与 `spoorAiTurns`（AI 生成历史）两个顶层键里。
 * 长文/人设/模板各一份 `*.json`。
 *
 * 这里只有**纯函数**：序列化、解析、镜像文档 ↔ 库行的互转。
 * 什么时候写、写到哪、怎么对账，在 mirrorScheduler / mirrorReconcile。
 */

import type {
  AgentConfig,
  AiTurn,
  Article,
  Canvas,
  CanvasNode,
  CanvasTemplate,
  Edge,
} from '../db';
import {
  exportCanvasToJsonCanvas,
  type JsonCanvasDocument,
  type JsonCanvasNode,
} from './jsonCanvas';
import { pickSpoorExtension } from './nodeFieldRegistry';

export const MIRROR_FORMAT_VERSION = 1;

export interface CanvasMirrorMeta {
  format: number;
  canvasId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 单调修订号；只用于快速判断"谁更新"，冲突合并看节点级 updatedAt。 */
  revision: number;
  /** 本次写盘时间戳。启动对账拿它与记账表比对来发现外部修改。 */
  savedAt: number;
}

export interface CanvasMirrorFile {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasDocument['edges'];
  spoorMeta: CanvasMirrorMeta;
  spoorAiTurns: AiTurn[];
}

export function canvasMirrorFileName(canvasId: string): string {
  return `${canvasId}.canvas`;
}

export function buildCanvasMirrorContent(params: {
  canvas: Canvas;
  nodes: CanvasNode[];
  edges: Edge[];
  aiTurns: AiTurn[];
  revision: number;
  savedAt: number;
}): string {
  const doc = exportCanvasToJsonCanvas(params.nodes, params.edges);
  const file: CanvasMirrorFile = {
    nodes: doc.nodes,
    edges: doc.edges,
    spoorMeta: {
      format: MIRROR_FORMAT_VERSION,
      canvasId: params.canvas.id,
      name: params.canvas.name,
      createdAt: params.canvas.createdAt,
      updatedAt: params.canvas.updatedAt,
      revision: params.revision,
      savedAt: params.savedAt,
    },
    spoorAiTurns: params.aiTurns,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** 解析镜像文件。半截/损坏/不是镜像（比如用户手放进来的普通 .canvas）返回 null。 */
export function parseCanvasMirrorFile(raw: string): CanvasMirrorFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.nodes)) return null;
  const meta = rec.spoorMeta as CanvasMirrorMeta | undefined;
  if (!meta || typeof meta !== 'object' || typeof meta.canvasId !== 'string') return null;
  if (typeof meta.savedAt !== 'number' || typeof meta.revision !== 'number') return null;
  return {
    nodes: rec.nodes as JsonCanvasNode[],
    edges: Array.isArray(rec.edges) ? (rec.edges as JsonCanvasDocument['edges']) : [],
    spoorMeta: meta,
    spoorAiTurns: Array.isArray(rec.spoorAiTurns) ? (rec.spoorAiTurns as AiTurn[]) : [],
  };
}

/**
 * 镜像节点 → 库行，**保留原 id**（与导入副本的 importJsonCanvas 相反：
 * 镜像是同一份数据的另一台机器视角，id 就是身份，改了就没法按行合并）。
 */
export function mirrorNodeToRow(raw: JsonCanvasNode, canvasId: string): CanvasNode | null {
  if (!raw || typeof raw.id !== 'string') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ext = (raw.spoor ?? {}) as Record<string, unknown>;
  const type = typeof ext.type === 'string' ? ext.type : raw.type === 'group' ? 'frame' : 'text';

  const row: CanvasNode = {
    ...pickSpoorExtension(ext),
    id: raw.id,
    canvasId,
    type,
    x,
    y,
    width: Number.isFinite(raw.width) ? Number(raw.width) : undefined,
    height: Number.isFinite(raw.height) ? Number(raw.height) : undefined,
  };
  // 规范原生属性按导出映射反推。content 优先取 spoor 扩展里的原始值
  // （ai/theme 的 text 是派生投影，见 jsonCanvas.buildExtension；content 在注册表里是
  // native 策略，pickSpoorExtension 不会捡它，这里显式取），扩展没有才用 text。
  if (typeof ext.content === 'string') {
    row.content = ext.content;
  } else if (raw.type === 'text' && typeof raw.text === 'string') {
    row.content = raw.text;
  }
  if (raw.type === 'file' && typeof raw.file === 'string' && !row.filePath) {
    row.filePath = raw.file;
  }
  if (raw.type === 'link' && typeof raw.url === 'string') row.url = raw.url;
  if (raw.type === 'group' && row.content === undefined) row.content = raw.label ?? '';
  return row;
}

export function mirrorFileToRows(
  file: CanvasMirrorFile,
): { nodes: CanvasNode[]; edges: Edge[]; aiTurns: AiTurn[] } {
  const canvasId = file.spoorMeta.canvasId;
  const nodes = file.nodes
    .map((raw) => mirrorNodeToRow(raw, canvasId))
    .filter((n): n is CanvasNode => n !== null);
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = file.edges
    .filter((e) => typeof e.id === 'string' && ids.has(e.fromNode) && ids.has(e.toNode))
    .map((e) => ({ id: e.id, canvasId, from: e.fromNode, to: e.toNode }));
  const aiTurns = file.spoorAiTurns.filter(
    (turn) => turn && typeof turn.id === 'string' && ids.has(turn.nodeId),
  );
  return { nodes, edges, aiTurns };
}

// ── 全局表的镜像（长文/人设/模板）──

export interface GlobalMirrorFile<T> {
  format: number;
  scope: 'articles' | 'agents' | 'templates';
  savedAt: number;
  revision: number;
  rows: T[];
}

export const GLOBAL_MIRROR_FILES = {
  articles: 'articles.json',
  agents: 'agents.json',
  templates: 'templates.json',
} as const;

export function buildGlobalMirrorContent(
  scope: keyof typeof GLOBAL_MIRROR_FILES,
  rows: (Article | AgentConfig | CanvasTemplate)[],
  revision: number,
  savedAt: number,
): string {
  const file: GlobalMirrorFile<unknown> = {
    format: MIRROR_FORMAT_VERSION,
    scope,
    savedAt,
    revision,
    rows,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseGlobalMirrorFile(raw: string): GlobalMirrorFile<Record<string, unknown>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.rows) || typeof rec.savedAt !== 'number') return null;
  if (rec.scope !== 'articles' && rec.scope !== 'agents' && rec.scope !== 'templates') return null;
  return rec as unknown as GlobalMirrorFile<Record<string, unknown>>;
}
