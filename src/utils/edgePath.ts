/**
 * 连线几何：出口（源卡片右侧中点）→ 入口（目标卡片左侧中点）的三次贝塞尔。
 *
 * 为什么不是直线：端口固定在左右两侧后，一旦目标卡片在源卡片左边，直线会
 * 横穿两张卡片。带水平控制点的贝塞尔会先向右探出、再从左侧绕回目标，
 * 任何相对位置下都不穿卡片，方向也读得出来。
 *
 * 纯函数，便于单测；rAF 循环只负责把结果塞进 `d` 属性。
 */

/** 控制点水平伸出量。太短则贴着卡片打折，太长则回环夸张，按间距取中并夹住两端。 */
const MIN_CONTROL_OFFSET = 40;
const MAX_CONTROL_OFFSET = 200;

export function edgeControlOffset(x1: number, x2: number): number {
  const dx = Math.abs(x2 - x1);
  return Math.min(Math.max(dx * 0.5, MIN_CONTROL_OFFSET), MAX_CONTROL_OFFSET);
}

/** 出口一律向右探出、入口一律从左侧进入，因此两个控制点的方向是固定的。 */
export function buildEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const offset = edgeControlOffset(x1, x2);
  const c1x = x1 + offset;
  const c2x = x2 - offset;
  return `M ${x1},${y1} C ${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
}

/**
 * 曲线 t=0.5 处的点，用来摆删除按钮。
 *
 * 三次贝塞尔在 t=0.5 的解析解是 (P0 + 3·P1 + 3·P2 + P3) / 8——直接取端点中点
 * 会让按钮偏离曲线，尤其在回环的情形下会飘到卡片上。
 */
export function edgeMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const offset = edgeControlOffset(x1, x2);
  const c1x = x1 + offset;
  const c2x = x2 - offset;
  return {
    x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    // 控制点与端点同高，y 分量因此退化成两端点的均值
    y: (y1 + 3 * y1 + 3 * y2 + y2) / 8,
  };
}
