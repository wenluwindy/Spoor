import type { CanvasNode } from '../db';

/**
 * 画布内搜索。
 *
 * 搜的是**节点里人写的字**：便签正文、主题卡的标题/说明/页脚、文档与媒体的文件名、
 * 生图节点的提示词、Agent 卡对应的人设名。刻意不搜 id、路径、生图历史这些机器字段——
 * 用户按 Ctrl+F 时脑子里想的是"我写过那句话"，不是"那行数据长什么样"。
 *
 * 匹配一律不区分大小写。中文没有大小写之分，但文件名、模型名、英文笔记都有。
 */

export interface CanvasSearchMatch {
  nodeId: string;
  canvasId: string;
  /** 命中处前后各截一段，用于结果列表。 */
  snippet: string;
}

/** 摘要里命中处两侧各保留多少字符。 */
export const SNIPPET_RADIUS = 32;

/** 参与搜索的字段，按"最像标题"的顺序排——摘要优先从靠前的字段里取。 */
export function nodeSearchFields(node: CanvasNode, agentName?: string): string[] {
  return [
    node.content ?? '',
    node.description ?? '',
    node.themeTag ?? '',
    node.fileName ?? '',
    node.imageGenPrompt ?? '',
    node.userTurn ?? '',
    agentName ?? '',
  ].filter((s) => s.trim() !== '');
}

/**
 * 从命中位置向两侧各截一段。开头/结尾之外的部分用省略号标出，
 * 好让人一眼看出这只是片段而不是全文。
 */
export function buildSnippet(text: string, query: string, radius: number = SNIPPET_RADIUS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, radius * 2);

  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2);

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export interface SearchCanvasNodesOptions {
  /** Agent 卡自己没有正文，名字要从人设表里查。 */
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
}

/**
 * 在给定节点里找出命中项，保持传入顺序。
 *
 * 空查询返回空数组，不是"全部命中"——否则一打开搜索框整张画布都被选中。
 */
export function searchCanvasNodes(
  nodes: CanvasNode[],
  query: string,
  options: SearchCanvasNodesOptions = {},
): CanvasSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: CanvasSearchMatch[] = [];
  for (const node of nodes) {
    const agentName = options.agentNameById?.(node.agentConfigId);
    const fields = nodeSearchFields(node, agentName);
    const hit = fields.find((f) => f.toLowerCase().includes(needle));
    if (hit === undefined) continue;
    matches.push({
      nodeId: node.id,
      canvasId: node.canvasId || 'default',
      snippet: buildSnippet(hit, query),
    });
  }
  return matches;
}

/** 在 `total` 个结果里循环挪动 `step` 步；空结果返回 0。 */
export function stepSearchIndex(current: number, total: number, step: number): number {
  if (total <= 0) return 0;
  return (((current + step) % total) + total) % total;
}
