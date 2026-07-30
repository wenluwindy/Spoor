import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCanvasCenterPosition, screenToCanvasPosition } from '../../src/utils/canvas';

describe('screenToCanvasPosition', () => {
  const rect = { left: 80, top: 40 };

  it('默认 transform 下等于相对容器的偏移', () => {
    expect(screenToCanvasPosition(300, 200, rect, { x: 0, y: 0, scale: 1 })).toEqual({
      x: 220,
      y: 160,
    });
  });

  it('扣除画布平移量', () => {
    expect(screenToCanvasPosition(300, 200, rect, { x: 100, y: 60, scale: 1 })).toEqual({
      x: 120,
      y: 100,
    });
  });

  it('按缩放比换算', () => {
    expect(screenToCanvasPosition(300, 200, rect, { x: 0, y: 0, scale: 2 })).toEqual({
      x: 110,
      y: 80,
    });
  });

  it('平移与缩放叠加：先扣平移再除缩放', () => {
    expect(screenToCanvasPosition(300, 200, rect, { x: 20, y: 10, scale: 0.5 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('容器不在视口左上角时结果不受偏移影响', () => {
    const t = { x: 0, y: 0, scale: 1 };
    const a = screenToCanvasPosition(300, 200, { left: 0, top: 0 }, t);
    const b = screenToCanvasPosition(380, 240, { left: 80, top: 40 }, t);
    expect(a).toEqual(b);
  });

  it('与 App 拖放落点的既有算式一致', () => {
    const transform = { x: 37, y: -11, scale: 1.3 };
    const clientX = 512;
    const clientY = 333;
    const legacy = {
      x: (clientX - rect.left - transform.x) / transform.scale,
      y: (clientY - rect.top - transform.y) / transform.scale,
    };
    expect(screenToCanvasPosition(clientX, clientY, rect, transform)).toEqual(legacy);
  });
});

describe('getCanvasCenterPosition', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('默认 transform 返回视口中心附近的坐标', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 1 });
    // jsdom innerWidth=1024, innerHeight=768
    // x = (512 - 0) / 1 - 150 + 0.5*50 = 387
    // y = (384 - 0) / 1 - 100 + 0.5*50 = 309
    expect(result.x).toBe(387);
    expect(result.y).toBe(309);
  });

  it('缩放后坐标正确换算', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 2 });
    // x = (512 - 0) / 2 - 150 + 25 = 131
    // y = (384 - 0) / 2 - 100 + 25 = 117
    expect(result.x).toBe(131);
    expect(result.y).toBe(117);
  });

  it('平移后坐标正确换算', () => {
    const result = getCanvasCenterPosition({ x: 100, y: 200, scale: 1 });
    // x = (512 - 100) / 1 - 150 + 25 = 287
    // y = (384 - 200) / 1 - 100 + 25 = 109
    expect(result.x).toBe(287);
    expect(result.y).toBe(109);
  });

  it('极小 scale 值不会出错', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 0.1 });
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it('极大 scale 值坐标变小', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 10 });
    expect(result.x).toBeLessThan(100);
    expect(result.y).toBeLessThan(100);
  });
});
