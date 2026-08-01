import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  groupIdsForDrag,
  isFrame,
  nodesInsideFrame,
} from '../../src/services/canvasFrame';

const node = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  canvasId: 'c1',
  type: 'text',
  x,
  y,
  ...extra,
});

const frame = (x: number, y: number, width = 400, height = 300): CanvasNode => ({
  id: 'frame',
  canvasId: 'c1',
  type: 'frame',
  x,
  y,
  width,
  height,
});

describe('canvasFrame', () => {
  describe('框住了谁', () => {
    it('中心点在框内的算成员', () => {
      // 卡片默认按 320×160 估算中心，(0,0) 的卡中心在 (160,80)
      expect(nodesInsideFrame(frame(0, 0), [node('a', 0, 0)])).toEqual(['a']);
    });

    it('中心点在框外的不算，哪怕边缘压进来一点', () => {
      // 中心在 (560,80)，超出宽度 400 的框
      expect(nodesInsideFrame(frame(0, 0), [node('a', 400, 0)])).toEqual([]);
    });

    it('探出去半个身位仍然算——这与人看画布时的判断一致', () => {
      // 中心 (390, 80) 还在框内，右半边已经出框
      expect(nodesInsideFrame(frame(0, 0), [node('a', 230, 0)])).toEqual(['a']);
    });

    it('别的框不算成员：嵌套会让「拖谁动谁」没法预期', () => {
      const other: CanvasNode = { ...frame(10, 10, 100, 100), id: 'other' };
      expect(nodesInsideFrame(frame(0, 0), [other])).toEqual([]);
    });

    it('框自己不算自己的成员', () => {
      const f = frame(0, 0);
      expect(nodesInsideFrame(f, [f])).toEqual([]);
    });

    it('按节点自己的宽高算中心', () => {
      // 宽 100 高 100 的卡放在 (350,0)，中心 (400,50) 恰在框内
      expect(nodesInsideFrame(frame(0, 0), [node('a', 350, 0, { width: 100, height: 100 })])).toEqual([
        'a',
      ]);
    });

    it('框没写宽高时用默认大小', () => {
      const f: CanvasNode = { id: 'f', canvasId: 'c1', type: 'frame', x: 0, y: 0 };
      const far = node('a', DEFAULT_FRAME_WIDTH - 10, DEFAULT_FRAME_HEIGHT - 10);
      expect(nodesInsideFrame(f, [far])).toEqual([]);
      expect(nodesInsideFrame(f, [node('b', 10, 10)])).toEqual(['b']);
    });
  });

  describe('拖动时带着谁', () => {
    const cards = [node('a', 10, 10), node('b', 1000, 1000)];

    it('拖区域框带着框里的卡片', () => {
      expect(groupIdsForDrag(frame(0, 0), [frame(0, 0), ...cards], [])).toEqual(['frame', 'a']);
    });

    it('空框不进入整组拖拽，避免无谓的广播', () => {
      expect(groupIdsForDrag(frame(5000, 5000), [...cards], [])).toEqual([]);
    });

    it('拖普通卡片带的是选区，不掺框里的成员', () => {
      expect(groupIdsForDrag(cards[0], [frame(0, 0), ...cards], ['a', 'b'])).toEqual(['a', 'b']);
    });
  });

  it('isFrame 只认 frame 类型', () => {
    expect(isFrame(frame(0, 0))).toBe(true);
    expect(isFrame(node('a', 0, 0))).toBe(false);
    expect(isFrame(undefined)).toBe(false);
  });
});
