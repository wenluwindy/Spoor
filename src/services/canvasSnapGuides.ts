/**
 * 拖动时的对象间吸附与对齐辅助线。
 *
 * 三个部分：
 * 1. **吸附目标登记**：App 在节点数据变化时把"其他卡片的对齐线"（左/中/右、上/中/下）
 *    喂进来。模块级单例——useDraggable 在 DraggableNode 深处，没有别的顺路通道，
 *    为这一条数据穿五层 props 不值得。
 * 2. **吸附计算**（纯函数 `snapToTargets`）：拖动中的卡片三条线各自找阈值内最近的目标线，
 *    命中就把坐标调整过去。**对象吸附优先于网格吸附**，同帧只允许一个吸附源生效——
 *    两套一起拉扯会让卡片在两个位置之间抖。
 * 3. **辅助线 store**：命中的线发布给画布层画出来（useSyncExternalStore），
 *    拖拽结束清空。
 */

import { useSyncExternalStore } from 'react';

/** 吸附命中阈值（屏幕像素）；调用方按缩放换算成画布单位。 */
export const SNAP_GUIDE_THRESHOLD_PX = 6;

export interface SnapTargets {
  /** 竖直对齐线的 x 坐标（其他卡片的左缘/中线/右缘），已排序去重。 */
  xs: number[];
  /** 水平对齐线的 y 坐标。 */
  ys: number[];
  /** 线属于哪些节点：拖动整组时要把组内成员的线排除掉。 */
  xOwners: Map<number, Set<string>>;
  yOwners: Map<number, Set<string>>;
}

export interface SnapGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildSnapTargets(nodes: SnapGeometry[]): SnapTargets {
  const xOwners = new Map<number, Set<string>>();
  const yOwners = new Map<number, Set<string>>();
  const put = (map: Map<number, Set<string>>, value: number, id: string) => {
    const key = Math.round(value);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  };
  for (const n of nodes) {
    put(xOwners, n.x, n.id);
    put(xOwners, n.x + n.width / 2, n.id);
    put(xOwners, n.x + n.width, n.id);
    put(yOwners, n.y, n.id);
    if (n.height > 0) {
      put(yOwners, n.y + n.height / 2, n.id);
      put(yOwners, n.y + n.height, n.id);
    }
  }
  return {
    xs: [...xOwners.keys()].sort((a, b) => a - b),
    ys: [...yOwners.keys()].sort((a, b) => a - b),
    xOwners,
    yOwners,
  };
}

export interface SnapResult {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

function nearestLine(
  candidates: number[],
  owners: Map<number, Set<string>>,
  exclude: Set<string>,
  probes: number[],
  threshold: number,
): { line: number; offset: number } | null {
  let best: { line: number; offset: number } | null = null;
  for (const line of candidates) {
    const ownerSet = owners.get(line);
    // 线只属于被排除的节点（自己/同组成员）时不吸——自己不能当自己的参照物
    if (ownerSet && [...ownerSet].every((id) => exclude.has(id))) continue;
    for (const probe of probes) {
      const offset = line - probe;
      if (Math.abs(offset) > threshold) continue;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { line, offset };
    }
  }
  return best;
}

/**
 * 拖动中的卡片按目标线吸附。返回调整后的坐标与命中的辅助线（没命中为 null）。
 * `threshold` 已是画布单位（调用方除过 scale）。
 */
export function snapToTargets(
  targets: SnapTargets,
  moving: { x: number; y: number; width: number; height: number },
  excludeIds: Set<string>,
  threshold: number,
): SnapResult {
  const xProbes = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const yProbes =
    moving.height > 0
      ? [moving.y, moving.y + moving.height / 2, moving.y + moving.height]
      : [moving.y];

  const hitX = nearestLine(targets.xs, targets.xOwners, excludeIds, xProbes, threshold);
  const hitY = nearestLine(targets.ys, targets.yOwners, excludeIds, yProbes, threshold);

  return {
    x: hitX ? moving.x + hitX.offset : moving.x,
    y: hitY ? moving.y + hitY.offset : moving.y,
    guideX: hitX ? hitX.line : null,
    guideY: hitY ? hitY.line : null,
  };
}

// ── 模块级单例：目标登记 + 辅助线 store ──

let currentTargets: SnapTargets | null = null;
/** 关掉对象吸附的开关（与网格开关同级，此版恒开；留口子给设置项）。 */
let snapEnabled = true;

export function setSnapTargets(targets: SnapTargets | null): void {
  currentTargets = targets;
}

export function getSnapTargets(): SnapTargets | null {
  return snapEnabled ? currentTargets : null;
}

export function setObjectSnapEnabled(enabled: boolean): void {
  snapEnabled = enabled;
}

export interface ActiveGuides {
  x: number | null;
  y: number | null;
}

const NO_GUIDES: ActiveGuides = { x: null, y: null };
let activeGuides: ActiveGuides = NO_GUIDES;
const listeners = new Set<() => void>();

export function publishSnapGuides(x: number | null, y: number | null): void {
  if (activeGuides.x === x && activeGuides.y === y) return;
  activeGuides = x === null && y === null ? NO_GUIDES : { x, y };
  listeners.forEach((fn) => fn());
}

export function clearSnapGuides(): void {
  publishSnapGuides(null, null);
}

/** 画布层订阅当前辅助线；没有拖拽命中时是稳定的空对象。 */
export function useSnapGuides(): ActiveGuides {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => activeGuides,
  );
}

/** 仅供测试。 */
export function resetSnapGuidesForTests(): void {
  currentTargets = null;
  snapEnabled = true;
  activeGuides = NO_GUIDES;
  listeners.clear();
}
