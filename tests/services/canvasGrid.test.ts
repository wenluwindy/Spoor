import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CANVAS_GRID_SIZE,
  CANVAS_GRID_STORAGE_KEY,
  isCanvasGridEnabled,
  resetCanvasGridStoreForTests,
  setCanvasGridEnabled,
  snapToGrid,
  subscribeCanvasGrid,
  toggleCanvasGrid,
} from '../../src/services/canvasGrid';

describe('canvasGrid store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCanvasGridStoreForTests();
  });

  it('默认关闭', () => {
    expect(isCanvasGridEnabled()).toBe(false);
  });

  it('toggle 翻转状态并持久化', () => {
    toggleCanvasGrid();
    expect(isCanvasGridEnabled()).toBe(true);
    expect(localStorage.getItem(CANVAS_GRID_STORAGE_KEY)).toBe('1');

    toggleCanvasGrid();
    expect(isCanvasGridEnabled()).toBe(false);
    expect(localStorage.getItem(CANVAS_GRID_STORAGE_KEY)).toBe('0');
  });

  it('从 localStorage 恢复开启状态', () => {
    localStorage.setItem(CANVAS_GRID_STORAGE_KEY, '1');
    resetCanvasGridStoreForTests();
    expect(isCanvasGridEnabled()).toBe(true);
  });

  it('设置成相同值时不通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasGrid(listener);
    setCanvasGridEnabled(false);
    expect(listener).not.toHaveBeenCalled();

    setCanvasGridEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('snapToGrid', () => {
  it('就近对齐到格点', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(11)).toBe(0);
    expect(snapToGrid(13)).toBe(24);
    expect(snapToGrid(25)).toBe(24);
    expect(snapToGrid(36)).toBe(48);
  });

  it('负坐标同样对齐（画布可以往左上无限延伸）', () => {
    expect(snapToGrid(-11)).toBe(-0);
    expect(snapToGrid(-13)).toBe(-24);
    expect(snapToGrid(-48)).toBe(-48);
  });

  it('size 为 0 或非法时原样返回，等于不吸附', () => {
    expect(snapToGrid(37, 0)).toBe(37);
    expect(snapToGrid(37, -5)).toBe(37);
    expect(snapToGrid(37, Number.NaN)).toBe(37);
  });

  it('格距与 index.css 的 .canvas-grid 背景尺寸一致', () => {
    expect(CANVAS_GRID_SIZE).toBe(24);
  });
});
