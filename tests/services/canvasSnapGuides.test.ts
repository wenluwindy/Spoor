import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  buildSnapTargets,
  clearSnapGuides,
  publishSnapGuides,
  resetSnapGuidesForTests,
  snapToTargets,
  useSnapGuides,
} from '../../src/services/canvasSnapGuides';

describe('canvasSnapGuides', () => {
  beforeEach(() => {
    resetSnapGuidesForTests();
  });

  const targets = () =>
    buildSnapTargets([
      { id: 'ref', x: 100, y: 100, width: 200, height: 100 },
    ]);

  it('目标线包含左/中/右与上/中/下', () => {
    const t = targets();
    expect(t.xs).toEqual([100, 200, 300]);
    expect(t.ys).toEqual([100, 150, 200]);
  });

  it('高度未知的节点只贡献顶线', () => {
    const t = buildSnapTargets([{ id: 'a', x: 0, y: 40, width: 100, height: 0 }]);
    expect(t.ys).toEqual([40]);
  });

  it('阈值内左缘吸到别的卡的左缘并给出辅助线', () => {
    const result = snapToTargets(targets(), { x: 104, y: 500, width: 80, height: 40 }, new Set(['me']), 6);
    expect(result.x).toBe(100);
    expect(result.guideX).toBe(100);
    // y 相距太远，不吸
    expect(result.guideY).toBeNull();
    expect(result.y).toBe(500);
  });

  it('中线对中线也能吸（移动卡的中心贴参照卡的中心）', () => {
    // 移动卡宽 80，x=163 时中心 203，距参照中心线 200 差 3
    const result = snapToTargets(targets(), { x: 163, y: 500, width: 80, height: 40 }, new Set(), 6);
    expect(result.x).toBe(160);
    expect(result.guideX).toBe(200);
  });

  it('多条线都在阈值内时取最近的', () => {
    const t = buildSnapTargets([
      { id: 'a', x: 100, y: 0, width: 10, height: 10 },
      { id: 'b', x: 103, y: 0, width: 10, height: 10 },
    ]);
    const result = snapToTargets(t, { x: 104, y: 500, width: 50, height: 10 }, new Set(), 6);
    expect(result.x).toBe(103);
  });

  it('只属于被排除节点（自己/同组）的线不参与吸附', () => {
    const result = snapToTargets(targets(), { x: 104, y: 500, width: 80, height: 40 }, new Set(['ref']), 6);
    expect(result.guideX).toBeNull();
    expect(result.x).toBe(104);
  });

  it('辅助线 store：发布/清空驱动订阅者，重复发布同值保持引用稳定', () => {
    const { result } = renderHook(() => useSnapGuides());
    expect(result.current).toEqual({ x: null, y: null });
    const empty = result.current;

    act(() => publishSnapGuides(10, 20));
    expect(result.current).toEqual({ x: 10, y: 20 });
    const snapshot = result.current;

    // 同值重复发布：快照引用不变（useSyncExternalStore 不空转）
    act(() => publishSnapGuides(10, 20));
    expect(result.current).toBe(snapshot);

    act(() => clearSnapGuides());
    // 清空回到稳定的空对象引用
    expect(result.current).toBe(empty);
  });
});
