import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, FileText, Loader2, Scissors } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NodeContentProps } from './types';
import { NodeTypeLabel } from './NodeTypeLabel';
import { mediaUrl } from '../../utils/mediaUrl';
import {
  clampPage,
  loadPdfDocument,
  pdfPageText,
  renderPdfPage,
  renderPdfTextLayer,
} from '../../services/pdfDocument';

export interface PdfNodeProps extends NodeContentProps {
  /** 摘录：把选中的（或整页的）文字变成一张连回本卡片的便签。 */
  onExtract?: (text: string) => void;
  /** 翻页要记进库，重开画布还停在这一页。 */
  onPageChange?: (page: number, pageCount: number) => void;
}

/** 页面渲染的目标宽度，与卡片默认宽度对齐。 */
const RENDER_WIDTH = 420;

/**
 * PDF 阅读卡片。
 *
 * Heptabase 与 Kosmik 的核心动作是「读着读着把一段摘出来变成卡片」——摘出来的那张卡
 * 自动连回 PDF，于是三个月后还能顺着线找回它是从哪一页来的。这里做的就是这件事。
 *
 * 渲染成画布 + 一层透明可选中的文字（pdf.js 的 `TextLayer`）。只画不选的话
 * 「摘录选中部分」就无从谈起，而那正是这张卡片存在的理由。
 */
export function PdfNode({ node, onExtract, onPageChange }: PdfNodeProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [pageCount, setPageCount] = useState(node.pdfPageCount ?? 0);
  const [page, setPage] = useState(node.pdfPage ?? 1);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const src = node.filePath ? mediaUrl(node.filePath) : '';

  // 打开文档。src 变了（换了文件）才重来
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setIsLoading(true);
    setFailed(false);

    void loadPdfDocument(src)
      .then((doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPage((prev) => clampPage(prev, doc.numPages));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [src]);

  // 画当前页
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const { page: pageProxy, viewport } = await renderPdfPage(doc, page, canvas, RENDER_WIDTH);
        if (cancelled || !textLayerRef.current) return;
        await renderPdfTextLayer(pageProxy, viewport, textLayerRef.current);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = clampPage(next, pageCount);
      if (clamped === page) return;
      setPage(clamped);
      onPageChange?.(clamped, pageCount);
    },
    [page, pageCount, onPageChange],
  );

  /**
   * 摘录。有选区就摘选区，没有就摘整页——读到一半想「把这页收下」时，
   * 不该被迫先手动全选一遍。
   */
  const extract = useCallback(async () => {
    const selected = window.getSelection()?.toString().trim();
    if (selected) {
      onExtract?.(selected);
      return;
    }
    const doc = docRef.current;
    if (!doc) return;
    const text = await pdfPageText(doc, page);
    if (text) onExtract?.(text);
  }, [onExtract, page]);

  return (
    <div className="w-full h-full bg-app-surface-raised border-2 border-app-border shadow-lg flex flex-col p-4 gap-2">
      <NodeTypeLabel
        icon={FileText}
        label={t('nodes.pdf_label')}
        trailing={
          node.fileName ? (
            <span className="text-[10px] font-mono text-app-text-muted ml-auto truncate max-w-[140px]" title={node.fileName}>
              {node.fileName}
            </span>
          ) : undefined
        }
      />

      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-app-surface-sunken/40 rounded flex justify-center">
        {failed ? (
          <p className="text-[11px] text-app-accent font-sans self-center px-4 text-center">
            {t('nodes.pdf_failed')}
          </p>
        ) : (
          <div className="relative">
            <canvas ref={canvasRef} className="block" />
            {/*
              文字层：透明地压在画布上，只为了让人能选中。
              `pdf-text-layer` 的定位样式在 index.css 里。
            */}
            <div ref={textLayerRef} className="pdf-text-layer" />
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-app-text-faint" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0" data-export-hide="">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label={t('nodes.pdf_prev')}
          className="p-1 rounded text-app-text-muted hover:text-app-accent disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono text-app-text-faint tabular-nums">
          {t('nodes.pdf_page_of', { page, total: pageCount || '—' })}
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => goTo(page + 1)}
          disabled={pageCount === 0 || page >= pageCount}
          aria-label={t('nodes.pdf_next')}
          className="p-1 rounded text-app-text-muted hover:text-app-accent disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void extract()}
          disabled={failed}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-sans font-bold text-app-accent hover:underline disabled:opacity-40"
        >
          <Scissors className="w-3 h-3" />
          {t('nodes.pdf_extract')}
        </button>
      </div>
    </div>
  );
}
