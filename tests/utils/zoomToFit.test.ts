import { describe, it, expect } from 'vitest';
import {
  computeFitTransform,
  unionNodeBoundsInCanvasSpace,
  FIT_PADDING_PX,
} from '../../src/utils/zoomToFit';

/** width/height 由 left/right/top/bottom 推出，省得每个用例重复写。 */
function elWithRect(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div');
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const right = rect.right ?? 0;
  const bottom = rect.bottom ?? 0;
  el.getBoundingClientRect = () =>
    ({
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: rect.width ?? right - left,
      height: rect.height ?? bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

const ORIGIN = { left: 0, top: 0 };
const IDENTITY = { x: 0, y: 0, scale: 1 };

describe('unionNodeBoundsInCanvasSpace', () => {
  it('没有元素时返回 null', () => {
    expect(unionNodeBoundsInCanvasSpace([], ORIGIN, IDENTITY)).toBeNull();
    expect(unionNodeBoundsInCanvasSpace([null, undefined], ORIGIN, IDENTITY)).toBeNull();
  });

  it('单个元素：identity 变换下即其屏幕矩形', () => {
    const el = elWithRect({ left: 100, top: 50, right: 300, bottom: 200 });
    expect(unionNodeBoundsInCanvasSpace([el], ORIGIN, IDENTITY)).toEqual({
      left: 100, top: 50, right: 300, bottom: 200,
    });
  });

  it('多个元素取并集', () => {
    const a = elWithRect({ left: 100, top: 50, right: 200, bottom: 150 });
    const b = elWithRect({ left: 400, top: 20, right: 500, bottom: 300 });
    expect(unionNodeBoundsInCanvasSpace([a, b], ORIGIN, IDENTITY)).toEqual({
      left: 100, top: 20, right: 500, bottom: 300,
    });
  });

  it('扣除容器偏移与画布平移，并按缩放换算回画布坐标', () => {
    const el = elWithRect({ left: 260, top: 160, right: 460, bottom: 360 });
    // (260 - 60 - 40) / 2 = 80 ; (160 - 10 - 30) / 2 = 60
    expect(
      unionNodeBoundsInCanvasSpace([el], { left: 60, top: 10 }, { x: 40, y: 30, scale: 2 }),
    ).toEqual({ left: 80, top: 60, right: 180, bottom: 160 });
  });

  it('跳过零尺寸元素（未挂载/隐藏）', () => {
    const real = elWithRect({ left: 10, top: 10, right: 20, bottom: 20 });
    const zero = elWithRect({ left: 999, top: 999, right: 999, bottom: 999, width: 0, height: 0 });
    expect(unionNodeBoundsInCanvasSpace([real, zero], ORIGIN, IDENTITY)).toEqual({
      left: 10, top: 10, right: 20, bottom: 20,
    });
  });
});

describe('computeFitTransform', () => {
  const viewport = { width: 1000, height: 800 };

  it('内容居中', () => {
    const t = computeFitTransform({ left: 0, top: 0, right: 200, bottom: 100 }, viewport);
    // 内容小于视口 → 不放大（scale 1），中心对齐
    expect(t.scale).toBe(1);
    expect(t.x).toBe(1000 / 2 - 100);
    expect(t.y).toBe(800 / 2 - 50);
  });

  it('内容超出视口时按较紧的一边缩小', () => {
    const t = computeFitTransform({ left: 0, top: 0, right: 4000, bottom: 800 }, viewport);
    // 可用宽 1000-144=856 → 856/4000 = 0.214；可用高 800-144=656 → 656/800 = 0.82，取小
    expect(t.scale).toBeCloseTo((1000 - FIT_PADDING_PX * 2) / 4000, 5);
  });

  it('留出四周空隙（内容不会顶到边）', () => {
    const bounds = { left: 0, top: 0, right: 2000, bottom: 1600 };
    const t = computeFitTransform(bounds, viewport);
    const screenLeft = bounds.left * t.scale + t.x;
    const screenRight = bounds.right * t.scale + t.x;
    expect(screenLeft).toBeGreaterThanOrEqual(FIT_PADDING_PX - 0.01);
    expect(screenRight).toBeLessThanOrEqual(viewport.width - FIT_PADDING_PX + 0.01);
  });

  it('默认不放大超过 1（内容很少时只居中，不糊成大图）', () => {
    const t = computeFitTransform({ left: 0, top: 0, right: 10, bottom: 10 }, viewport);
    expect(t.scale).toBe(1);
  });

  it('允许显式放大时受 maxScale 约束', () => {
    const t = computeFitTransform(
      { left: 0, top: 0, right: 100, bottom: 100 },
      viewport,
      { maxScale: 2 },
    );
    expect(t.scale).toBe(2);
  });

  it('缩放下限 0.1（内容极大时不会算出 0）', () => {
    const t = computeFitTransform({ left: 0, top: 0, right: 1e7, bottom: 1e7 }, viewport);
    expect(t.scale).toBe(0.1);
  });

  it('负坐标（画布左上方的节点）同样能居中', () => {
    const t = computeFitTransform({ left: -400, top: -300, right: -200, bottom: -100 }, viewport);
    const centerScreenX = ((-400 + -200) / 2) * t.scale + t.x;
    const centerScreenY = ((-300 + -100) / 2) * t.scale + t.y;
    expect(centerScreenX).toBeCloseTo(viewport.width / 2, 5);
    expect(centerScreenY).toBeCloseTo(viewport.height / 2, 5);
  });

  it('零面积包围盒不会产生除零', () => {
    const t = computeFitTransform({ left: 100, top: 100, right: 100, bottom: 100 }, viewport);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
    expect(t.scale).toBeGreaterThan(0);
  });
});
