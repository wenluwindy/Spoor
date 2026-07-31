import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGE_EDGE,
  MIN_IMAGE_EDGE,
  clampEdge,
  formatSize,
  matchesRatio,
  parseSize,
  sizeFromRatio,
} from '../../src/utils/imageSize';

describe('parseSize', () => {
  it('解析标准写法', () => {
    expect(parseSize('1920x1080')).toEqual({ width: 1920, height: 1080 });
  });

  it('容忍大写 X、中文乘号与空格', () => {
    expect(parseSize('1024X768')).toEqual({ width: 1024, height: 768 });
    expect(parseSize('1024×768')).toEqual({ width: 1024, height: 768 });
    expect(parseSize(' 800 x 600 ')).toEqual({ width: 800, height: 600 });
  });

  it('认不出来的一律给 null，而不是抛错', () => {
    for (const bad of ['', 'auto', '1024', 'x768', '0x100', '100x0', undefined, null]) {
      expect(parseSize(bad as string)).toBeNull();
    }
  });
});

describe('formatSize', () => {
  it('拼回字符串并对小数取整', () => {
    expect(formatSize(1024, 1024)).toBe('1024x1024');
    expect(formatSize(1023.6, 767.4)).toBe('1024x767');
  });
});

describe('clampEdge', () => {
  it('把边长收进合法区间', () => {
    expect(clampEdge(10)).toBe(MIN_IMAGE_EDGE);
    expect(clampEdge(99999)).toBe(MAX_IMAGE_EDGE);
    expect(clampEdge(1024)).toBe(1024);
  });

  it('非数字回落到默认边长而不是产出 NaN', () => {
    expect(clampEdge(Number.NaN)).toBe(1024);
  });
});

describe('sizeFromRatio', () => {
  it('长边固定，各比例像素量级才接近', () => {
    expect(sizeFromRatio(1, 1, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(sizeFromRatio(16, 9, 1024)).toEqual({ width: 1024, height: 576 });
    expect(sizeFromRatio(9, 16, 1024)).toEqual({ width: 576, height: 1024 });
  });

  it('竖版与横版互为镜像', () => {
    const wide = sizeFromRatio(16, 9, 1024);
    const tall = sizeFromRatio(9, 16, 1024);
    expect(tall.width).toBe(wide.height);
    expect(tall.height).toBe(wide.width);
  });

  it('非法比例退化为正方形', () => {
    expect(sizeFromRatio(0, 5, 800)).toEqual({ width: 800, height: 800 });
    expect(sizeFromRatio(-1, 2, 800)).toEqual({ width: 800, height: 800 });
  });

  it('结果同样受边长上下限约束', () => {
    expect(sizeFromRatio(100, 1, 4096).height).toBe(MIN_IMAGE_EDGE);
  });
});

describe('matchesRatio', () => {
  it('比例吻合时为真（用于高亮快捷项）', () => {
    expect(matchesRatio({ width: 1920, height: 1080 }, 16, 9)).toBe(true);
    expect(matchesRatio({ width: 1024, height: 1024 }, 1, 1)).toBe(true);
  });

  it('比例不符时为假', () => {
    expect(matchesRatio({ width: 1024, height: 768 }, 16, 9)).toBe(false);
  });

  it('零值不会算出 NaN 而误判', () => {
    expect(matchesRatio({ width: 0, height: 0 }, 1, 1)).toBe(false);
    expect(matchesRatio({ width: 100, height: 100 }, 1, 0)).toBe(false);
  });
});
