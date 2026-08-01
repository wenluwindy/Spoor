import type { CanvasViewTransform } from './canvas';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 适应后四周留出的空隙（屏幕像素）。 */
export const FIT_PADDING_PX = 72;
/** 与画布缩放范围保持一致。 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

/**
 * 把节点的屏幕包围盒并成一个画布坐标系下的包围盒。
 *
 * 用 `getBoundingClientRect()` 而不是数据库里的 x/y/width/height：
 * 后者的高度常常是 0（自适应高度），且不含旋转，算出来的框会偏。
 */
export function unionNodeBoundsInCanvasSpace(
  elements: (HTMLElement | null | undefined)[],
  containerRect: { left: number; top: number },
  transform: CanvasViewTransform,
): Bounds | null {
  let bounds: Bounds | null = null;

  for (const el of elements) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const left = (r.left - containerRect.left - transform.x) / transform.scale;
    const top = (r.top - containerRect.top - transform.y) / transform.scale;
    const right = (r.right - containerRect.left - transform.x) / transform.scale;
    const bottom = (r.bottom - containerRect.top - transform.y) / transform.scale;

    bounds = bounds
      ? {
          left: Math.min(bounds.left, left),
          top: Math.min(bounds.top, top),
          right: Math.max(bounds.right, right),
          bottom: Math.max(bounds.bottom, bottom),
        }
      : { left, top, right, bottom };
  }

  return bounds;
}

/**
 * 保持当前缩放，把包围盒挪到视口正中。
 *
 * 搜索定位用它而不是 `computeFitTransform`：跳到一张卡片时把画布缩放也一起改掉，
 * 会让人当场失去方位感——"我刚才在多大的比例上看"这件事必须保持不变。
 */
export function computeCenterTransform(
  bounds: Bounds,
  viewport: { width: number; height: number },
  scale: number,
): CanvasViewTransform {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    scale,
  };
}

/**
 * 算出让整个包围盒落在视口内的 transform。
 *
 * `maxScale` 默认 1：内容很少时不放大到失真，只居中。
 */
export function computeFitTransform(
  bounds: Bounds,
  viewport: { width: number; height: number },
  options: { padding?: number; maxScale?: number } = {},
): CanvasViewTransform {
  const padding = options.padding ?? FIT_PADDING_PX;
  const maxScale = options.maxScale ?? 1;

  const contentWidth = Math.max(bounds.right - bounds.left, 1);
  const contentHeight = Math.max(bounds.bottom - bounds.top, 1);
  const availableWidth = Math.max(viewport.width - padding * 2, 1);
  const availableHeight = Math.max(viewport.height - padding * 2, 1);

  const rawScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  const scale = Math.min(Math.max(rawScale, MIN_SCALE), Math.min(maxScale, MAX_SCALE));

  // 缩放后居中：视口中心对齐内容中心
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;

  return {
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    scale,
  };
}
