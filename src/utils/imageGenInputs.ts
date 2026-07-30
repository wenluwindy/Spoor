import type { CanvasNode, Edge } from '../db';

/**
 * 生图节点的输入解析：连过来的图片当参考图，连过来的文本当提示词。
 *
 * 三条关键取舍：
 * - **无向邻接**。`Edge` 有 `from`/`to`，但 UI 的连线一直是无向的
 *   （`handleLink` 不区分方向，Agent 分析也不区分），生图跟着来。
 * - **只取直接邻居，不递归**。A↔B 互相连着不会死循环，代价是链式参考图
 *   只能一层层传（上游生图节点的**当前结果**就是它的输出）。
 * - **参考图有上限**，超出的截断并报数量，而不是静默丢弃。
 */

/** 能当参考图的节点类型。`imagegen` 在内 —— 决策 5：输出可作为下游的参考图。 */
const REF_IMAGE_TYPES = new Set(['image', 'imagegen']);

/** 能当提示词来源的节点类型。 */
const TEXT_TYPES = new Set(['note', 'text', 'theme', 'ai', 'document']);

/** 硬上限。再多的参考图对各家模型都没意义，也把请求体撑得很大。 */
export const MAX_REF_IMAGES = 4;

export interface ImageGenRefImage {
  nodeId: string;
  /** 数据根内的相对路径，或旧节点的 data URL。Rust 侧两种都认。 */
  spec: string;
}

export interface ImageGenInputs {
  refImages: ImageGenRefImage[];
  /** 上游文本按节点 id 排序后用空行拼接。 */
  upstreamText: string;
  /** 被上限截掉的参考图数量，UI 要提示出来。 */
  ignoredRefCount: number;
  /** 邻居里有生图节点：说明可能存在互连，UI 提示「仅使用当前结果」。 */
  hasImageGenNeighbor: boolean;
}

/** 无向邻接：拿到与 `nodeId` 直接相连的所有节点 id。 */
export function neighborIdsOf(nodeId: string, edges: Pick<Edge, 'from' | 'to'>[]): string[] {
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge.from === nodeId) out.add(edge.to);
    else if (edge.to === nodeId) out.add(edge.from);
  }
  out.delete(nodeId);
  return [...out];
}

/** 一个节点能提供的参考图路径。生图节点给它**当前选中**的那张结果。 */
export function refSpecOf(node: CanvasNode): string | undefined {
  if (node.type === 'imagegen') {
    const results = node.imageGenResults ?? [];
    if (results.length === 0) return undefined;
    const index = node.imageGenActiveIndex ?? 0;
    return results[index] ?? results[0];
  }
  return node.filePath || node.content || undefined;
}

export interface CollectImageGenInputsOptions {
  /** 模型声明的参考图上限，与 `MAX_REF_IMAGES` 取小。 */
  maxRefImages?: number;
  /** 用户点掉的参考图节点 id。 */
  excludedRefIds?: string[];
  /** 只用节点自己的提示词。 */
  ignoreUpstreamText?: boolean;
}

export function collectImageGenInputs(
  nodeId: string,
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
  options: CollectImageGenInputsOptions = {},
): ImageGenInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const excluded = new Set(options.excludedRefIds ?? []);
  const limit = Math.max(0, Math.min(MAX_REF_IMAGES, options.maxRefImages ?? MAX_REF_IMAGES));

  // 排序让结果稳定：同一批连线每次算出来的顺序一致，不会因为边的存储顺序而抖动
  const neighbors = neighborIdsOf(nodeId, edges)
    .map((id) => byId.get(id))
    .filter((n): n is CanvasNode => n !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));

  const candidates: ImageGenRefImage[] = [];
  let hasImageGenNeighbor = false;
  const textParts: string[] = [];

  for (const node of neighbors) {
    if (REF_IMAGE_TYPES.has(node.type)) {
      if (node.type === 'imagegen') hasImageGenNeighbor = true;
      if (excluded.has(node.id)) continue;
      const spec = refSpecOf(node);
      if (spec) candidates.push({ nodeId: node.id, spec });
      continue;
    }
    if (!options.ignoreUpstreamText && TEXT_TYPES.has(node.type)) {
      const text = (node.content ?? '').trim();
      if (text) textParts.push(text);
    }
  }

  return {
    refImages: candidates.slice(0, limit),
    ignoredRefCount: Math.max(0, candidates.length - limit),
    upstreamText: textParts.join('\n\n'),
    hasImageGenNeighbor,
  };
}

/**
 * 最终提示词：上游文本 + 节点自己的提示词。
 * 两者皆空时返回空串，调用方据此禁用生成按钮。
 */
export function buildImageGenPrompt(upstreamText: string, ownPrompt: string): string {
  return [upstreamText.trim(), ownPrompt.trim()].filter(Boolean).join('\n');
}
