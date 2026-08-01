import { describe, it, expect } from 'vitest';
import type { CanvasNode, Edge } from '../../src/db';
import {
  CULLING_THRESHOLD,
  isNodeWithinBounds,
  viewportBoundsInCanvas,
  visibleNodeIds,
} from '../../src/utils/viewportCulling';

const node = (id: string, x: number, y: number): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  x,
  y,
  width: 300,
  height: 150,
});

const edge = (from: string, to: string): Edge => ({ id: `${from}->${to}`, canvasId: 'c1', from, to });

/** 造一批填满阈值的远处节点，让裁剪真正启用。 */
function padding(count: number, offset = 100_000): CanvasNode[] {
  return Array.from({ length: count }, (_, i) => node(`pad-${i}`, offset + i, offset));
}

const VIEWPORT = { width: 1000, height: 800 };
const AT_ORIGIN = { x: 0, y: 0, scale: 1 };

describe('viewportCulling', () => {
  describe('视口范围换算', () => {
    it('画布未平移未缩放时，范围以原点开始并向四周外扩', () => {
      const bounds = viewportBoundsInCanvas(VIEWPORT, AT_ORIGIN, 0.5);
      expect(bounds.left).toBe(-500);
      expect(bounds.top).toBe(-400);
      expect(bounds.right).toBe(1500);
      expect(bounds.bottom).toBe(1200);
    });

    it('平移之后范围跟着走', () => {
      const bounds = viewportBoundsInCanvas(VIEWPORT, { x: -200, y: -100, scale: 1 }, 0);
      expect(bounds.left).toBe(200);
      expect(bounds.top).toBe(100);
    });

    it('缩小之后看到的画布范围更大', () => {
      const wide = viewportBoundsInCanvas(VIEWPORT, { x: 0, y: 0, scale: 0.5 }, 0);
      expect(wide.right - wide.left).toBe(2000);
    });
  });

  describe('节点是否落在范围内', () => {
    const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };

    it('完全在内的算可见', () => {
      expect(isNodeWithinBounds(node('a', 100, 100), bounds)).toBe(true);
    });

    it('只压到边也算可见——半张卡在屏幕上时不能不画', () => {
      expect(isNodeWithinBounds(node('a', -200, 100), bounds)).toBe(true);
    });

    it('完全在外的不算', () => {
      expect(isNodeWithinBounds(node('a', 5000, 100), bounds)).toBe(false);
      expect(isNodeWithinBounds(node('a', 100, -5000), bounds)).toBe(false);
    });
  });

  describe('可见集合', () => {
    it('节点数没到阈值时不裁剪', () => {
      const nodes = [node('a', 0, 0), node('b', 99_999, 99_999)];
      expect(visibleNodeIds(nodes, [], VIEWPORT, AT_ORIGIN)).toBeNull();
    });

    it('超过阈值才裁剪，远处的节点被摘掉', () => {
      const nodes = [node('near', 0, 0), ...padding(CULLING_THRESHOLD)];
      const visible = visibleNodeIds(nodes, [], VIEWPORT, AT_ORIGIN)!;
      expect(visible.has('near')).toBe(true);
      expect(visible.has('pad-0')).toBe(false);
    });

    it('与可见节点相连的节点留着，否则那条线会整根消失', () => {
      const nodes = [node('near', 0, 0), node('far', 99_999, 99_999), ...padding(CULLING_THRESHOLD)];
      const visible = visibleNodeIds(nodes, [edge('near', 'far')], VIEWPORT, AT_ORIGIN)!;
      expect(visible.has('far')).toBe(true);
    });

    it('两端都在视口外的连线不会把它们拉回来', () => {
      const nodes = [
        node('far1', 99_999, 99_999),
        node('far2', 99_500, 99_500),
        ...padding(CULLING_THRESHOLD),
      ];
      const visible = visibleNodeIds(nodes, [edge('far1', 'far2')], VIEWPORT, AT_ORIGIN)!;
      expect(visible.has('far1')).toBe(false);
      expect(visible.has('far2')).toBe(false);
    });

    it('视口尺寸拿不到时不裁剪，宁可全渲染也不要一片空白', () => {
      const nodes = [node('a', 0, 0), ...padding(CULLING_THRESHOLD)];
      expect(visibleNodeIds(nodes, [], { width: 0, height: 0 }, AT_ORIGIN)).toBeNull();
    });

    it('阈值可以调，便于测试与将来按机器性能调整', () => {
      const nodes = [node('near', 0, 0), node('far', 99_999, 99_999)];
      const visible = visibleNodeIds(nodes, [], VIEWPORT, AT_ORIGIN, { threshold: 1 })!;
      expect(visible.has('near')).toBe(true);
      expect(visible.has('far')).toBe(false);
    });
  });
});
