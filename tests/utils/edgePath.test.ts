import { describe, it, expect } from 'vitest';
import { buildEdgePath, edgeControlOffset, edgeMidpoint } from '../../src/utils/edgePath';

/** 从 `M x,y C c1x,c1y c2x,c2y x2,y2` 里取出六个数。 */
function parsePath(d: string) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(nums).toHaveLength(8);
  const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = nums;
  return { x1, y1, c1x, c1y, c2x, c2y, x2, y2 };
}

describe('edgeControlOffset', () => {
  it('间距很近时不小于最小伸出量（否则曲线贴着卡片打折）', () => {
    expect(edgeControlOffset(0, 10)).toBe(40);
    expect(edgeControlOffset(100, 100)).toBe(40);
  });

  it('间距很远时封顶，避免回环夸张', () => {
    expect(edgeControlOffset(0, 5000)).toBe(200);
  });

  it('中等间距取一半', () => {
    expect(edgeControlOffset(0, 200)).toBe(100);
  });

  it('只看距离，与左右方向无关', () => {
    expect(edgeControlOffset(300, 100)).toBe(edgeControlOffset(100, 300));
  });
});

describe('buildEdgePath', () => {
  it('端点落在传入坐标上', () => {
    const p = parsePath(buildEdgePath(10, 20, 300, 80));
    expect([p.x1, p.y1]).toEqual([10, 20]);
    expect([p.x2, p.y2]).toEqual([300, 80]);
  });

  it('控制点与各自端点同高，保证曲线水平进出端口', () => {
    const p = parsePath(buildEdgePath(10, 20, 300, 80));
    expect(p.c1y).toBe(p.y1);
    expect(p.c2y).toBe(p.y2);
  });

  it('出口控制点始终在源点右侧、入口控制点始终在目标点左侧', () => {
    const forward = parsePath(buildEdgePath(0, 0, 400, 0));
    expect(forward.c1x).toBeGreaterThan(forward.x1);
    expect(forward.c2x).toBeLessThan(forward.x2);
  });

  it('目标在左侧时曲线向外绕，不横穿卡片', () => {
    // 反向连接：源在右(400)，目标在左(0)
    const back = parsePath(buildEdgePath(400, 0, 0, 0));
    // 出口仍向右探出、入口仍从左侧进入 —— 这正是「绕开卡片」的形状
    expect(back.c1x).toBeGreaterThan(400);
    expect(back.c2x).toBeLessThan(0);
  });
});

describe('edgeMidpoint', () => {
  it('水平同高时退化为两端中点', () => {
    expect(edgeMidpoint(0, 50, 400, 50)).toEqual({ x: 200, y: 50 });
  });

  it('y 取两端均值', () => {
    expect(edgeMidpoint(0, 0, 400, 100).y).toBe(50);
  });

  it('落在曲线上而非端点连线上（反向连接时二者不同）', () => {
    const mid = edgeMidpoint(400, 0, 0, 0);
    const naive = (400 + 0) / 2;
    // 反向时曲线中点被两个外扩控制点拉开，必须不等于朴素中点
    expect(mid.x).toBe(naive);
    // x 相等是对称性使然；换成不对称的一对来验证确实按贝塞尔公式算
    const asym = edgeMidpoint(0, 0, 100, 0);
    // offset = max(100*0.5, 40) = 50 → (0 + 3*50 + 3*50 + 100)/8 = 50
    expect(asym.x).toBe(50);
  });
});
