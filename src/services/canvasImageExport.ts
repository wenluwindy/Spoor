/**
 * 把画布导出成图片。
 *
 * 走的是**渲染真实 DOM**（`html-to-image`）而不是照着节点数据另画一遍。理由是主题：
 * 四套主题改的不只是配色，连卡片外壳的形态都不一样，另画一遍意味着把那套样式在导出
 * 代码里再实现一遍，并且从此每改一次主题就要改两处。渲染 DOM 则天然所见即所得。
 *
 * 三个必须处理的细节：
 *
 * 1. **导的是全部内容，不是当前视口**。先量出所有卡片的包围盒，再把内容层临时挪到
 *    原点、按 1:1 铺开，让截图尺寸等于内容尺寸——否则缩得很小时导出来就是一张糊图。
 * 2. **界面控件不入画**。连线端口、删除按钮、缩放手柄这些只在鼠标悬停时才有意义的
 *    东西，出现在导出的图里只会是噪点。靠 `data-export-hide` 标记统一滤掉。
 * 3. **失败要说人话**。画布是空的、或者浏览器拒绝渲染（跨域图片等）时返回明确的原因，
 *    而不是丢一张空白图给用户。
 */

import type { CanvasViewTransform } from '../utils/canvas';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { unionNodeBoundsInCanvasSpace, type Bounds } from '../utils/zoomToFit';

export type CanvasImageFormat = 'png' | 'svg';

/** 导出图四周留出的空白（画布坐标）。 */
export const EXPORT_PADDING = 48;

/** PNG 的像素密度。2 倍在常见屏幕上足够清晰，再高文件会大得离谱。 */
export const EXPORT_PIXEL_RATIO = 2;

/** 单边像素上限。超大画布按比例缩小，免得浏览器直接拒绝分配画布。 */
export const MAX_EXPORT_EDGE_PX = 12000;

export interface CanvasImageRequest {
  /** 承载全部节点、带 transform 的那一层。 */
  contentContainer: HTMLElement;
  /** 视口容器，用来把 DOM 坐标换算回画布坐标。 */
  viewport: HTMLElement;
  /** 当前的画布 transform。 */
  transform: CanvasViewTransform;
  /** 每个节点的根元素。 */
  nodeElements: (HTMLElement | null | undefined)[];
  format: CanvasImageFormat;
  /** 导出图的底色，取自当前主题。 */
  backgroundColor: string;
}

export class CanvasImageExportError extends Error {
  constructor(public readonly code: 'empty' | 'render_failed') {
    super(code);
    this.name = 'CanvasImageExportError';
  }
}

/** 包围盒加上四周留白。 */
export function padBounds(bounds: Bounds, padding: number = EXPORT_PADDING): Bounds {
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    right: bounds.right + padding,
    bottom: bounds.bottom + padding,
  };
}

/**
 * 算出导出用的尺寸与缩放。
 *
 * 内容再大也不能无限放大画布——浏览器对单个 canvas 的面积有上限，超过就直接抛错。
 * 这里按最长边压回上限之内，宁可小一点也要出得来。
 */
export function computeExportSize(
  bounds: Bounds,
  pixelRatio: number,
  maxEdge: number = MAX_EXPORT_EDGE_PX,
): { width: number; height: number; pixelRatio: number } {
  const width = Math.max(1, Math.round(bounds.right - bounds.left));
  const height = Math.max(1, Math.round(bounds.bottom - bounds.top));
  const longest = Math.max(width, height) * pixelRatio;
  const ratio = longest > maxEdge ? (pixelRatio * maxEdge) / longest : pixelRatio;
  return { width, height, pixelRatio: ratio };
}

/** 导出时要滤掉的元素：带 `data-export-hide` 的一律不进画。 */
export function shouldRenderForExport(node: HTMLElement): boolean {
  return !(node.dataset && 'exportHide' in node.dataset);
}

/**
 * 渲染出一张图，返回 data URL。
 *
 * 内容层的 transform 被临时换成「挪到原点、1:1」，因此截出来的是全部内容的原始尺寸，
 * 与用户当前缩放到哪一级无关。这个替换只发生在 `html-to-image` 克隆出来的那份 DOM 上，
 * 页面上的画布不受影响。
 */
export async function renderCanvasImage(request: CanvasImageRequest): Promise<string> {
  const { contentContainer, viewport, transform, nodeElements, format, backgroundColor } = request;

  const raw = unionNodeBoundsInCanvasSpace(nodeElements, viewport.getBoundingClientRect(), transform);
  if (!raw) throw new CanvasImageExportError('empty');

  const bounds = padBounds(raw);
  const { width, height, pixelRatio } = computeExportSize(bounds, EXPORT_PIXEL_RATIO);

  const options = {
    width,
    height,
    pixelRatio,
    backgroundColor,
    filter: shouldRenderForExport,
    style: {
      // 覆盖掉页面上的平移缩放：内容左上角对齐到 (0,0)，比例回到 1:1
      transform: `translate(${-bounds.left}px, ${-bounds.top}px)`,
      transformOrigin: 'top left',
    },
  };

  try {
    const { toPng, toSvg } = await import('html-to-image');
    return format === 'svg' ? await toSvg(contentContainer, options) : await toPng(contentContainer, options);
  } catch {
    throw new CanvasImageExportError('render_failed');
  }
}

/** `data:image/png;base64,XXXX` → `XXXX`。不是 data URL 时返回 null。 */
export function base64FromDataUrl(dataUrl: string): string | null {
  const at = dataUrl.indexOf('base64,');
  if (at < 0) return null;
  const payload = dataUrl.slice(at + 'base64,'.length);
  return payload || null;
}

/**
 * 存下渲染好的图。
 *
 * 桌面端把 base64 原样递给 Rust 解码写盘（见 `user_file_write_base64`）；
 * 浏览器调试时直接用 data URL 触发下载。
 *
 * @returns 是否真的落盘（用户取消保存对话框返回 false）
 */
export async function saveCanvasImage(defaultFileName: string, dataUrl: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = defaultFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  const payload = base64FromDataUrl(dataUrl);
  if (!payload) throw new CanvasImageExportError('render_failed');

  const { save } = await import('@tauri-apps/plugin-dialog');
  const dest = await save({
    defaultPath: defaultFileName,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!dest) return false;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('user_file_write_base64', { destPath: dest, contents: payload });
  return true;
}
