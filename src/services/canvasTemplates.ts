/**
 * 画布模板：把一组卡片 + 内部连线存成可复用的快照。
 *
 * 序列化直接骑在剪贴板的结构上（`canvasClipboard`）：模板本质上就是一份
 * 存进库里的"永久剪贴板"，插入 = 粘贴到指定位置。重用同一套收集/重映射逻辑，
 * 新增 `CanvasNode` 字段时只要剪贴板不丢，模板就不丢。
 *
 * 模板里的媒体节点（图片/生图结果）存的是相对路径引用，与原件共享同一份文件——
 * 与复制粘贴的行为一致；在存储设置里删掉原件会让模板里的引用一起失效。
 */

import { db, type CanvasNode, type Edge } from '../db';
import {
  buildCanvasClipboardPayload,
  materializeCanvasClipboard,
} from '../utils/canvasClipboard';
import { addNodesAndEdgesRecorded } from './canvasMutations';

/** 存模板。坐标归一化到左上原点，插入时按目标点摆。返回模板 id。 */
export async function saveCanvasTemplate(
  name: string,
  nodes: CanvasNode[],
  edges: Edge[],
): Promise<string | null> {
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const baseX = Math.min(...nodes.map((n) => n.x));
  const baseY = Math.min(...nodes.map((n) => n.y));
  const id = crypto.randomUUID();
  await db.templates.add({
    id,
    name,
    createdAt: Date.now(),
    nodes: nodes.map((n) => ({ ...n, x: n.x - baseX, y: n.y - baseY })),
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  });
  return id;
}

/** 插入模板：全部行重发 id，整批算一步撤销。返回新建节点 id。 */
export async function insertCanvasTemplate(
  templateId: string,
  canvasId: string,
  at: { x: number; y: number },
): Promise<string[]> {
  const template = await db.templates.get(templateId);
  if (!template) return [];
  const payload = buildCanvasClipboardPayload(template.nodes, template.edges);
  if (!payload) return [];
  const { nodes, edges } = materializeCanvasClipboard(payload, canvasId, at);
  return addNodesAndEdgesRecorded(canvasId, nodes, edges);
}

export async function deleteCanvasTemplate(templateId: string): Promise<void> {
  await db.templates.delete(templateId);
}
