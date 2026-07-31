/**
 * 生图尺寸的解析与拼装。
 *
 * 尺寸在数据库里就是一个字符串（`CanvasNode.imageGenParams.size`），Rust 侧
 * [imagegen.rs] 也只是把它原样塞进请求体，所以本来就不限于服务商预设里的那几个值。
 * 这里把「字符串 ↔ 宽高」的换算收成纯函数，UI 与测试共用一套规则。
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** 常见比例快捷项：无预设尺寸的服务商（Gemini / 自定义）靠它给个起点。 */
export const IMAGE_ASPECT_RATIOS = [
  { id: '1:1', w: 1, h: 1 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '4:3', w: 4, h: 3 },
] as const;

export const DEFAULT_IMAGE_SIZE = '1024x1024';

/** 边长夹在这个区间：低于 64 基本没有服务商接受，高于 4096 多数会直接拒。 */
export const MIN_IMAGE_EDGE = 64;
export const MAX_IMAGE_EDGE = 4096;

/** `'1920x1080'` → `{width:1920,height:1080}`；认不出来返回 null（含大写 X）。 */
export function parseSize(raw: string | undefined | null): ImageDimensions | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*$/i.exec(raw);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width, height };
}

export function formatSize(width: number, height: number): string {
  return `${Math.round(width)}x${Math.round(height)}`;
}

/** 把边长收进 [MIN, MAX]；非数字回落到默认边长。 */
export function clampEdge(value: number): number {
  if (!Number.isFinite(value)) return 1024;
  return Math.min(MAX_IMAGE_EDGE, Math.max(MIN_IMAGE_EDGE, Math.round(value)));
}

/**
 * 按比例给一组边长，长边固定为 `longEdge`。
 *
 * 取长边而非宽度作基准，1:1 与 9:16 才不会一个 1024 一个 1820——
 * 同一个基准下各比例的像素量级才接近。
 */
export function sizeFromRatio(ratioW: number, ratioH: number, longEdge = 1024): ImageDimensions {
  if (ratioW <= 0 || ratioH <= 0) return { width: longEdge, height: longEdge };
  const scale = longEdge / Math.max(ratioW, ratioH);
  return {
    width: clampEdge(ratioW * scale),
    height: clampEdge(ratioH * scale),
  };
}

/** 当前尺寸是否与某个比例吻合（允许 1% 误差，用于高亮快捷项）。 */
export function matchesRatio(size: ImageDimensions, ratioW: number, ratioH: number): boolean {
  if (!size.width || !size.height || ratioH <= 0) return false;
  return Math.abs(size.width / size.height - ratioW / ratioH) < 0.01;
}
