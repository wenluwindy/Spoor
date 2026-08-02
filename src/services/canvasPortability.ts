/**
 * 画布的进出：导出成 `.canvas`（JSON Canvas），或从 `.canvas` 导入。
 *
 * 格式转换本身在 `jsonCanvas` 里，是纯函数；这里只负责跟数据库和文件对话框打交道。
 *
 * 导入一律**落到一张新画布**，而不是并进当前画布。理由是可逆性：导错了文件，删掉那张
 * 新画布就干净了；并进来则要在几十张卡里挑出哪些是刚导入的。也因为落在新画布上，
 * 这一步不进撤销栈——撤销栈按画布隔离，新画布的历史从空开始才说得通。
 */

import { db, type Canvas, type CanvasNode, type Edge } from '../db';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { openTextFile, pickDirectory, saveTextFile, saveTextFileTo } from '../utils/userTextFile';
import { collectReferencedMedia } from './backup';
import { mediaExport } from './mediaStore';
import { ASSETS_DIR, allocateAssetNames, canvasToMarkdown } from './canvasMarkdown';
import {
  JSON_CANVAS_FILE_EXTENSION,
  exportCanvasToJsonCanvas,
  importJsonCanvas,
  parseJsonCanvas,
  serializeJsonCanvas,
  type ImportDegradations,
} from './jsonCanvas';

/** 文件名里不能出现的字符换成短横，免得画布名带了斜杠就存不下去。 */
export function toSafeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned || 'canvas';
}

/** 读出一张画布的全部内容（节点、连线、人设名解析器）。 */
async function loadCanvas(canvasId: string): Promise<{
  nodes: CanvasNode[];
  edges: Edge[];
  agentNameById: (id: string | undefined) => string | undefined;
}> {
  // canvasId 由 v5 迁移与 db hook 保证必有，可以直接走索引
  const [nodes, edges, agents] = await Promise.all([
    db.nodes.where('canvasId').equals(canvasId).toArray(),
    db.edges.where('canvasId').equals(canvasId).toArray(),
    db.agents.toArray(),
  ]);
  return {
    nodes,
    edges,
    agentNameById: (id) => {
      const agent = agents.find((a) => a.id === id);
      return agent ? resolveAgentLocalizedName(agent) : undefined;
    },
  };
}

/**
 * 导出一张画布。
 *
 * @returns 是否真的落盘（用户取消保存对话框返回 false）
 */
export async function exportCanvasToFile(canvasId: string, canvasName: string): Promise<boolean> {
  const { nodes, edges, agentNameById } = await loadCanvas(canvasId);
  const doc = exportCanvasToJsonCanvas(nodes, edges, { agentNameById });

  return saveTextFile(
    `${toSafeFileName(canvasName)}.${JSON_CANVAS_FILE_EXTENSION}`,
    serializeJsonCanvas(doc),
    [{ name: 'JSON Canvas', extensions: [JSON_CANVAS_FILE_EXTENSION] }],
  );
}

export interface MarkdownBundleOutcome {
  /** 写到哪个目录（浏览器里只下载了一个 .md 时为 null）。 */
  directory: string | null;
  assetsCopied: number;
  /** 引用了但没能复制出来的媒体（原件被删了、或不在文件存储里）。 */
  assetsMissing: number;
}

/**
 * 导出成 Markdown 包：一篇 `.md` + 一个 `assets/` 目录。
 *
 * 媒体是**复制**出去的而不是引用回 `SpoorData/`：这个包的用处就是发给别人或搬去别处，
 * 链接指回本机的数据目录等于发过去一堆打不开的图。
 *
 * 浏览器调试时没有目录可选，退回只下载 `.md`（图片链接会指向不存在的 assets/，
 * 这一点由返回值里的 `directory: null` 告诉调用方）。
 *
 * @returns 用户取消选目录时返回 null
 */
export async function exportCanvasAsMarkdown(
  canvasId: string,
  canvasName: string,
  now: Date,
): Promise<MarkdownBundleOutcome | null> {
  const { nodes, edges, agentNameById } = await loadCanvas(canvasId);
  const fileStem = toSafeFileName(canvasName);

  if (!isTauriRuntime()) {
    const markdown = canvasToMarkdown(nodes, edges, {
      canvasName,
      exportedAt: now,
      agentNameById,
    });
    const written = await saveTextFile(`${fileStem}.md`, markdown, [
      { name: 'Markdown', extensions: ['md'] },
    ]);
    return written ? { directory: null, assetsCopied: 0, assetsMissing: 0 } : null;
  }

  const directory = await pickDirectory();
  if (!directory) return null;

  const referenced = collectReferencedMedia(nodes);
  const assetNameByPath = allocateAssetNames(referenced);

  const markdown = canvasToMarkdown(nodes, edges, {
    canvasName,
    exportedAt: now,
    agentNameById,
    assetNameByPath,
  });

  await saveTextFileTo(`${directory}/${fileStem}.md`, markdown);

  let assetsCopied = 0;
  let assetsMissing = 0;
  for (const [rel, name] of assetNameByPath) {
    try {
      await mediaExport(rel, `${directory}/${ASSETS_DIR}/${name}`);
      assetsCopied += 1;
    } catch {
      // 原件被删了或不在文件存储里。整包不该因为一张图失败而失败，如实计数即可
      assetsMissing += 1;
    }
  }

  return { directory, assetsCopied, assetsMissing };
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
