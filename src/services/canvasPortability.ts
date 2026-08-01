/**
 * 画布的进出：导出成 `.canvas`（JSON Canvas），或从 `.canvas` 导入。
 *
 * 格式转换本身在 `jsonCanvas` 里，是纯函数；这里只负责跟数据库和文件对话框打交道。
 *
 * 导入一律**落到一张新画布**，而不是并进当前画布。理由是可逆性：导错了文件，删掉那张
 * 新画布就干净了；并进来则要在几十张卡里挑出哪些是刚导入的。也因为落在新画布上，
 * 这一步不进撤销栈——撤销栈按画布隔离，新画布的历史从空开始才说得通。
 */

import { db, type Canvas } from '../db';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import { openTextFile, saveTextFile } from '../utils/userTextFile';
import {
  JSON_CANVAS_FILE_EXTENSION,
  exportCanvasToJsonCanvas,
  importJsonCanvas,
  parseJsonCanvas,
  serializeJsonCanvas,
  type ImportDegradations,
} from './jsonCanvas';

/** 旧数据里没有 `canvasId` 的行归 `'default'`，与 App 的过滤口径一致。 */
function belongsTo(owner: string | undefined, canvasId: string): boolean {
  return owner === canvasId || (!owner && canvasId === 'default');
}

/** 文件名里不能出现的字符换成短横，免得画布名带了斜杠就存不下去。 */
export function toSafeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned || 'canvas';
}

/**
 * 导出一张画布。
 *
 * @returns 是否真的落盘（用户取消保存对话框返回 false）
 */
export async function exportCanvasToFile(canvasId: string, canvasName: string): Promise<boolean> {
  const [nodes, edges, agents] = await Promise.all([
    db.nodes.filter((n) => belongsTo(n.canvasId, canvasId)).toArray(),
    db.edges.filter((e) => belongsTo(e.canvasId, canvasId)).toArray(),
    db.agents.toArray(),
  ]);

  const doc = exportCanvasToJsonCanvas(nodes, edges, {
    agentNameById: (id) => {
      const agent = agents.find((a) => a.id === id);
      return agent ? resolveAgentLocalizedName(agent) : undefined;
    },
  });

  return saveTextFile(
    `${toSafeFileName(canvasName)}.${JSON_CANVAS_FILE_EXTENSION}`,
    serializeJsonCanvas(doc),
    [{ name: 'JSON Canvas', extensions: [JSON_CANVAS_FILE_EXTENSION] }],
  );
}

export interface CanvasImportOutcome {
  /** 新建的画布 id，调用方据此切过去。 */
  canvasId: string;
  canvasName: string;
  nodeCount: number;
  edgeCount: number;
  degraded: ImportDegradations;
}

/**
 * 让用户挑一个 `.canvas` 导进来。
 *
 * @returns 取消返回 `null`；文件不是合法 JSON Canvas 时抛 `'invalid_json_canvas'`
 */
export async function importCanvasFromFile(): Promise<CanvasImportOutcome | null> {
  const picked = await openTextFile(
    [{ name: 'JSON Canvas', extensions: [JSON_CANVAS_FILE_EXTENSION] }],
    `.${JSON_CANVAS_FILE_EXTENSION},application/json`,
  );
  if (!picked) return null;

  const doc = parseJsonCanvas(picked.text);
  if (!doc) throw new Error('invalid_json_canvas');

  const canvasId = crypto.randomUUID();
  const canvasName = picked.fileName.replace(
    new RegExp(`\\.${JSON_CANVAS_FILE_EXTENSION}$`, 'i'),
    '',
  );
  const { nodes, edges, degraded } = importJsonCanvas(doc, canvasId);

  const canvas: Canvas = {
    id: canvasId,
    name: canvasName || canvasId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 画布行最后写：中途失败时不留下一张空壳画布
  if (nodes.length > 0) await db.nodes.bulkAdd(nodes);
  if (edges.length > 0) await db.edges.bulkAdd(edges);
  await db.canvases.add(canvas);

  return {
    canvasId,
    canvasName: canvas.name,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    degraded,
  };
}
