/**
 * pdf.js 的薄封装。
 *
 * 存在的理由有两个：
 *
 * 1. **worker 只配一次**。pdf.js 要一个 worker 脚本地址，配漏了会退化成主线程解析，
 *    翻一页就卡住整个界面。让它只在这里发生，组件不必知道有这回事。
 * 2. **按需加载**。pdf.js 有一兆多，绝大多数画布里根本没有 PDF。这里用动态 import
 *    把它切成独立 chunk，第一次真的打开 PDF 时才下载。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfModule = typeof import('pdfjs-dist');

let modulePromise: Promise<PdfModule> | null = null;

async function loadPdfModule(): Promise<PdfModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // `?url` 让 Vite 把 worker 当成资源产出并给出最终地址，打包后依然对得上
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return modulePromise;
}

export async function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfModule();
  return pdfjs.getDocument({ url }).promise;
}

/** 渲染一页到画布，并返回这一页的视口（文本层要按同一个视口定位）。 */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // 按卡片宽度定缩放，再乘设备像素比——不乘的话高分屏上是一页糊字
  const scale = targetWidth / base.width;
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale });

  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('no_2d_context');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  await page.render({ canvasContext: context, viewport }).promise;
  return { page, viewport };
}

/** 铺一层可选中的透明文字，盖在渲染好的页面上。 */
export async function renderPdfTextLayer(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  viewport: { width: number; height: number },
  container: HTMLElement,
): Promise<void> {
  const pdfjs = await loadPdfModule();
  container.innerHTML = '';
  container.style.width = `${Math.floor(viewport.width)}px`;
  container.style.height = `${Math.floor(viewport.height)}px`;

  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport: viewport as never,
  });
  await textLayer.render();
}

/** 整页文字，用于「摘成便签」没有选区时的兜底。 */
export async function pdfPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 页码夹到 `[1, total]`；总页数未知时返回 1。 */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page) || total <= 0) return 1;
  return Math.min(Math.max(Math.round(page), 1), total);
}
