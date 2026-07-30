import { describe, it, expect } from 'vitest';
import {
  layoutPlannedNodes,
  PLANNED_NODE_COL_GAP,
  PLANNED_NODE_ROW_GAP,
  PLANNED_NODE_MAX_COLS,
} from '../../src/utils/planNodePlacement';

const CENTER = { x: 1000, y: 500 };

describe('layoutPlannedNodes', () => {
  it('数量为 0 或负数时不产生落点', () => {
    expect(layoutPlannedNodes(0, CENTER)).toEqual([]);
    expect(layoutPlannedNodes(-3, CENTER)).toEqual([]);
  });

  it('单张就落在中心', () => {
    expect(layoutPlannedNodes(1, CENTER)).toEqual([CENTER]);
  });

  it('一行之内左右居中', () => {
    const points = layoutPlannedNodes(2, CENTER);
    expect(points).toEqual([
      { x: CENTER.x - PLANNED_NODE_COL_GAP / 2, y: CENTER.y },
      { x: CENTER.x + PLANNED_NODE_COL_GAP / 2, y: CENTER.y },
    ]);
  });

  it('超过列上限就换行', () => {
    const points = layoutPlannedNodes(PLANNED_NODE_MAX_COLS + 1, CENTER);
    const rows = new Set(points.map((p) => p.y));
    expect(rows.size).toBe(2);
    expect(points[PLANNED_NODE_MAX_COLS].y - points[0].y).toBe(PLANNED_NODE_ROW_GAP);
  });

  it('整块网格的中心就是给定的中心点', () => {
    for (const count of [1, 2, 3, 4, 5, 7, 12]) {
      const points = layoutPlannedNodes(count, CENTER);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(CENTER.x, 6);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(CENTER.y, 6);
    }
  });

  it('落点两两不重合', () => {
    const points = layoutPlannedNodes(12, CENTER);
    const keys = new Set(points.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(12);
  });

  it('落点数量与请求一致', () => {
    expect(layoutPlannedNodes(7, CENTER)).toHaveLength(7);
  });
});
