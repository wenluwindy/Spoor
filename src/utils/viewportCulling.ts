/**
 * 视口裁剪：画布上卡片多到一定程度时，只渲染看得见的那些。
 *
 * 三条约束决定了这里的写法，每一条都是为了不让优化变成 bug：
 *
 * 1. **卡片少时干脆不裁剪**。几十张卡全量渲染毫无压力，而裁剪会带来一整类
 *    "东西不见了"的问题。只有超过阈值才启用——省下的那点开销不值得让小画布也承担风险。
 * 2. **连线的两端都得在**。连线几何是读两端 DOM 算出来的（见 `useCanvasInteraction`），
 *    裁掉一端，整条线就消失了——而它本该画到屏幕外去。所以可见集合要包含
 *    "与可见节点相连的节点"，哪怕它自己在视口外。
 * 3. **导出与缩放至适应内容必须看到全部**。它们同样靠 DOM 量包围盒。调用方要先
 *    临时关掉裁剪（App 里的 `withAllNodesRendered`），否则导出的图只有当前屏幕这一块。
 */

import type { CanvasNode, Edge } from '../db';
import type { CanvasViewTransform } from './canvas';

/**
 * 低于这个节点数一律全量渲染。
 * 0.4.0 从 150 降到 60：memo 化之后渲染树本身便宜了，但每张卡的 DOM 仍不小，
 * 60 张之外的部分裁掉对中等画布已经有感知收益。
 */
export const CULLING_THRESHOLD = 60;

/** 视口四周额外保留多少（按视口尺寸的比例）：平移时提前把卡片准备好，不至于"边滚边冒"。 */
export const CULLING_MARGIN_RATIO = 0.75;

/** 节点没写宽高时的估算值，与 `canvasFrame` 保持一致。 */
const ASSUMED_WIDTH = 320;
const ASSUMED_HEIGHT = 160;

export interface ViewportSize {
  width: number;
  height: number;
}

/** 视口在画布坐标系里的范围（含外扩的余量）。 */
export function viewportBoundsInCanvas(
  viewport: ViewportSize,
  transform: CanvasViewTransform,
  marginRatio: number = CULLING_MARGIN_RATIO,
) {
  const scale = transform.scale || 1;
  const marginX = (viewport.width * marginRatio) / scale;
  const marginY = (viewport.height * marginRatio) / scale;
  const left = -transform.x / scale - marginX;
  const top = -transform.y / scale - marginY;
  return {
    left,
    top,
    right: left + viewport.width / scale + marginX * 2,
    bottom: top + viewport.height / scale + marginY * 2,
  };
}

export function isNodeWithinBounds(
  node: CanvasNode,
  bounds: { left: number; top: number; right: number; bottom: number },
): boolean {
  const right = node.x + (node.width ?? ASSUMED_WIDTH);
  const bottom = node.y + (node.height || ASSUMED_HEIGHT);
  return !(right < bounds.left || node.x > bounds.right || bottom < bounds.top || node.y > bounds.bottom);
}

/**
 * 该渲染哪些节点。
 *
 * @returns `null` 表示不裁剪（节点数没到阈值，或调用方要求全渲染）——调用方据此直接用原数组，
 *          省掉一次无意义的过滤。
 */
export function visibleNodeIds(
  nodes: CanvasNode[],
  edges: Edge[],
  viewport: ViewportSize,
  transform: CanvasViewTransform,
  options: { threshold?: number; marginRatio?: number } = {},
): Set<string> | null {
  const threshold = options.threshold ?? CULLING_THRESHOLD;
  if (nodes.length <= threshold) return null;
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const bounds = viewportBoundsInCanvas(viewport, transform, options.marginRatio);
  const visible = new Set<string>();
  for (const node of nodes) {
    if (isNodeWithinBounds(node, bounds)) visible.add(node.id);
  }

  // 与可见节点相连的节点也留着，否则那条线会整根消失
  for (const edge of edges) {
    if (visible.has(edge.from) !== visible.has(edge.to)) {
      visible.add(edge.from);
      visible.add(edge.to);
    }
  }

  return visible;
}
