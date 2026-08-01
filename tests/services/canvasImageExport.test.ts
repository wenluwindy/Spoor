import { describe, it, expect } from 'vitest';
import {
  EXPORT_PADDING,
  MAX_EXPORT_EDGE_PX,
  base64FromDataUrl,
  computeExportSize,
  padBounds,
  shouldRenderForExport,
} from '../../src/services/canvasImageExport';

describe('canvasImageExport', () => {
  describe('包围盒', () => {
    it('四周各加一圈留白', () => {
      expect(padBounds({ left: 0, top: 0, right: 100, bottom: 50 })).toEqual({
        left: -EXPORT_PADDING,
        top: -EXPORT_PADDING,
        right: 100 + EXPORT_PADDING,
        bottom: 50 + EXPORT_PADDING,
      });
    });
  });

  describe('导出尺寸', () => {
    it('尺寸等于内容尺寸，与用户当前缩放无关', () => {
      const size = computeExportSize({ left: -10, top: -10, right: 90, bottom: 40 }, 2);
      expect(size.width).toBe(100);
      expect(size.height).toBe(50);
      expect(size.pixelRatio).toBe(2);
    });

    it('超大画布按最长边压回上限——浏览器对 canvas 面积有硬限制', () => {
      const size = computeExportSize({ left: 0, top: 0, right: 20000, bottom: 1000 }, 2);
      expect(size.width * size.pixelRatio).toBeLessThanOrEqual(MAX_EXPORT_EDGE_PX);
      expect(size.pixelRatio).toBeLessThan(2);
    });

    it('零宽高的边界情况不会算出 0 尺寸', () => {
      const size = computeExportSize({ left: 5, top: 5, right: 5, bottom: 5 }, 2);
      expect(size.width).toBe(1);
      expect(size.height).toBe(1);
    });
  });

  describe('过滤界面控件', () => {
    it('带 data-export-hide 的元素不入画', () => {
      const hidden = document.createElement('div');
      hidden.setAttribute('data-export-hide', '');
      expect(shouldRenderForExport(hidden)).toBe(false);
    });

    it('普通元素照常渲染', () => {
      expect(shouldRenderForExport(document.createElement('div'))).toBe(true);
    });
  });

  describe('data URL', () => {
    it('取出 base64 载荷', () => {
      expect(base64FromDataUrl('data:image/png;base64,AAAB')).toBe('AAAB');
    });

    it('不是 base64 data URL 时返回 null', () => {
      expect(base64FromDataUrl('data:image/svg+xml,<svg/>')).toBeNull();
      expect(base64FromDataUrl('data:image/png;base64,')).toBeNull();
      expect(base64FromDataUrl('随便一段字')).toBeNull();
    });
  });
});
