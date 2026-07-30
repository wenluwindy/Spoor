import type { CanvasPoint } from '../hooks/useNodeActions';

/**
 * 一次建多张节点时的落点：以给定点为中心排成网格。
 *
 * 沿用节点默认宽 320（见 `DraggableNode` 的 `initialWidth`）再留一点缝；
 * 高度是自适应的，行距按「一张便签大致高度」给，重叠了用户拖开即可。
 */

export const PLANNED_NODE_COL_GAP = 360;
export const PLANNED_NODE_ROW_GAP = 260;
/** 每行最多几张。超过 3 列在 1080p 上就会溢出可视区。 */
export const PLANNED_NODE_MAX_COLS = 3;

export function layoutPlannedNodes(count: number, center: CanvasPoint): CanvasPoint[] {
  if (count <= 0) return [];

  const cols = Math.min(count, PLANNED_NODE_MAX_COLS);
  const rows = Math.ceil(count / cols);
  // 网格整体居中：左上角回退半个网格
  const originX = center.x - ((cols - 1) * PLANNED_NODE_COL_GAP) / 2;
  const originY = center.y - ((rows - 1) * PLANNED_NODE_ROW_GAP) / 2;

  return Array.from({ length: count }, (_, i) => ({
    x: originX + (i % cols) * PLANNED_NODE_COL_GAP,
    y: originY + Math.floor(i / cols) * PLANNED_NODE_ROW_GAP,
  }));
}
