import type { CanvasNode } from '../db';

/**
 * 演示模式的播放顺序（B7）。
 *
 * 纯函数：只看节点与连线，不摸 DOM、不落库。播放顺序遵循两条直觉：
 * 1. 连线即讲述顺序——从起点（或没有入边的根）沿连线 BFS 展开，讲完上游讲下游；
 * 2. 没连线的卡片按"从上到下、从左到右"的阅读顺序附加在尾部。
 *
 * 同层节点按 y 再 x（再 id 兜底）排序，保证同一张画布每次生成的顺序完全一致——
 * 演示者预演过一遍的顺序，正式讲时必须原样重现。
 *
 * frame（区域框）是背景不是内容，一律跳过；成环靠 visited 集合保证不死循环。
 */

export interface PresentationEdge {
  from: string;
  to: string;
}

/** 阅读顺序：先上后下，同高先左后右；坐标完全相同时按 id 兜底，确保确定性。 */
function readingOrderCompare(a: CanvasNode, b: CanvasNode): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/**
 * 生成播放顺序（有序 nodeId 数组）。
 *
 * @param nodes   画布上的全部节点；frame 会被剔除。
 * @param edges   画布上的连线；端点不在内容节点里的边被忽略。
 * @param startId 「从这里开始讲」的起点。缺省或无效（不存在 / 是 frame）时，
 *                从所有没有入边的根出发。
 */
export function buildPresentationOrder(
  nodes: CanvasNode[],
  edges: PresentationEdge[],
  startId?: string,
): string[] {
  const contentNodes = nodes.filter((n) => n.type !== 'frame');
  const byId = new Map(contentNodes.map((n) => [n.id, n]));
  const sortedNodes = [...contentNodes].sort(readingOrderCompare);

  // 邻接表与入度都只统计内容节点之间的边（连到 frame 或已删节点的边不算）。
  const outNeighbors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const list = outNeighbors.get(edge.from);
    if (list) list.push(edge.to);
    else outNeighbors.set(edge.from, [edge.to]);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const order: string[] = [];
  const visited = new Set<string>();

  // 起点：显式 startId 优先；否则取所有"没有入边、且至少连出一条边"的根。
  // 完全没连线的孤立卡片不当根——它们属于"不连通的其余卡片"，统一附加在尾部。
  const seeds =
    startId !== undefined && byId.has(startId)
      ? [startId]
      : sortedNodes
          .filter((n) => (inDegree.get(n.id) ?? 0) === 0 && outNeighbors.has(n.id))
          .map((n) => n.id);

  // 逐层 BFS：每一层整体按阅读顺序排完再进入下一层。
  let level = seeds.filter((id) => !visited.has(id));
  level.forEach((id) => visited.add(id));
  while (level.length > 0) {
    level.sort((a, b) => readingOrderCompare(byId.get(a)!, byId.get(b)!));
    order.push(...level);

    const next: string[] = [];
    for (const id of level) {
      for (const neighbor of outNeighbors.get(id) ?? []) {
        if (visited.has(neighbor)) continue; // 环在这里被掐断，不会死循环
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    level = next;
  }

  // 剩下的（孤岛、纯环成分、startId 覆盖不到的其他连通块）按阅读顺序附加在尾部。
  for (const node of sortedNodes) {
    if (!visited.has(node.id)) order.push(node.id);
  }
  return order;
}
