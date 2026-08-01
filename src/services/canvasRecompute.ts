/**
 * 沿边重算：上游改了，把下游按依赖顺序重跑一遍。
 *
 * 这是 Flora / Figma Weave 那类「节点即步骤」画布的核心心智，而 Spoor 早就有边了，
 * 缺的只是一个执行器。这个文件只管**算出顺序**（纯函数，好测），真正的重跑在
 * `hooks/useCanvasRecompute` 里。
 *
 * 两条规则：
 *
 * - **只沿箭头方向走**。边是有向的（右出左进），「下游」就是顺着箭头能到的地方。
 *   把边当无向的话，改一张便签会顺带重跑跟它同级的所有兄弟节点。
 * - **拓扑序，且不怕成环**。A→B→A 这种图在画布上是画得出来的；遇到环就把环里
 *   还没排上的节点留在最后，而不是死循环或者整个放弃。
 */

import type { CanvasNode, Edge } from '../db';

/** 能被重算的节点类型。别的类型（便签、图片、文档…）没有"重新生成"这个概念。 */
export const RECOMPUTABLE_TYPES = ['ai', 'imagegen'] as const;

export type RecomputableType = (typeof RECOMPUTABLE_TYPES)[number];

export function isRecomputable(node: CanvasNode | undefined): boolean {
  return Boolean(node && (RECOMPUTABLE_TYPES as readonly string[]).includes(node.type));
}

/** 顺着箭头能到达的全部节点（不含起点自己）。 */
export function collectDownstreamIds(startId: string, edges: Edge[]): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of outgoing.get(current) ?? []) {
      if (next === startId || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * 把一批节点按依赖排序：一个节点的所有上游都排完了，才轮到它。
 *
 * 只看**这批节点内部**的边——上游那些不重算的便签当然已经"就绪"了。
 * 环里的节点谁也等不到谁，按原顺序缀在最后：与其一个不跑，不如按能确定的顺序跑完。
 */
export function topologicalOrder(ids: string[], edges: Edge[]): string[] {
  const inScope = new Set(ids);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!inScope.has(edge.from) || !inScope.has(edge.to) || edge.from === edge.to) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  // 保持传入顺序，让同层节点的先后可预期
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  const done = new Set<string>();

  while (ready.length > 0) {
    const id = ready.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }

  // 成环的部分
  for (const id of ids) {
    if (!done.has(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * 从 `startId` 出发要重算哪些节点，按什么顺序。
 *
 * @param includeStart 起点本身是不是也要重跑（右键「重新生成」在自己身上时为 true）
 */
export function planRecompute(
  startId: string,
  nodes: CanvasNode[],
  edges: Edge[],
  includeStart = false,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const downstream = [...collectDownstreamIds(startId, edges)];
  const candidates = includeStart ? [startId, ...downstream] : downstream;
  const recomputable = candidates.filter((id) => isRecomputable(byId.get(id)));
  // 拓扑排序在全部下游节点上做，再筛出可重算的——不可重算的便签也参与传递依赖
  const ordered = topologicalOrder(includeStart ? [startId, ...downstream] : downstream, edges);
  const keep = new Set(recomputable);
  return ordered.filter((id) => keep.has(id));
}
