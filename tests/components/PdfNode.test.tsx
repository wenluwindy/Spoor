import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CanvasNode } from '../../src/db';

const loadPdfDocument = vi.hoisted(() => vi.fn());
const renderPdfPage = vi.hoisted(() => vi.fn());
const renderPdfTextLayer = vi.hoisted(() => vi.fn());
const pdfPageText = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

vi.mock('../../src/services/pdfDocument', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/pdfDocument')>()),
  loadPdfDocument,
  renderPdfPage,
  renderPdfTextLayer,
  pdfPageText,
}));

const { PdfNode } = await import('../../src/components/nodes/PdfNode');

const node = (extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'document',
  fileType: 'pdf',
  filePath: 'documents/a.pdf',
  fileName: 'a.pdf',
  x: 0,
  y: 0,
  ...extra,
});

describe('PdfNode', () => {
  const onExtract = vi.fn();
  const onPageChange = vi.fn();

  beforeEach(() => {
    onExtract.mockClear();
    onPageChange.mockClear();
    loadPdfDocument.mockClear();
    renderPdfPage.mockClear();
    renderPdfTextLayer.mockClear();
    pdfPageText.mockClear();
    loadPdfDocument.mockResolvedValue({ numPages: 5, destroy: vi.fn() });
    renderPdfPage.mockResolvedValue({ page: {}, viewport: { width: 400, height: 500 } });
    renderPdfTextLayer.mockResolvedValue(undefined);
    pdfPageText.mockResolvedValue('整页的文字');
  });

  const renderNode = (n: CanvasNode = node()) =>
    render(
      <PdfNode
        node={n}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        onExtract={onExtract}
        onPageChange={onPageChange}
      />,
    );

  it('打开后显示总页数', async () => {
    renderNode();
    await waitFor(() =>
      expect(screen.getByText('nodes.pdf_page_of:{"page":1,"total":5}')).toBeInTheDocument(),
    );
  });

  it('从上次读到的那一页接着看', async () => {
    renderNode(node({ pdfPage: 3 }));
    await waitFor(() =>
      expect(screen.getByText('nodes.pdf_page_of:{"page":3,"total":5}')).toBeInTheDocument(),
    );
  });

  it('翻页把页码交出去持久化', async () => {
    renderNode();
    await waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('nodes.pdf_next'));
    expect(onPageChange).toHaveBeenCalledWith(2, 5);
  });

  it('第一页时上一页禁用，最后一页时下一页禁用', async () => {
    renderNode(node({ pdfPage: 1 }));
    await waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());
    expect(screen.getByLabelText('nodes.pdf_prev')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('nodes.pdf_next'));
    fireEvent.click(screen.getByLabelText('nodes.pdf_next'));
    fireEvent.click(screen.getByLabelText('nodes.pdf_next'));
    fireEvent.click(screen.getByLabelText('nodes.pdf_next'));
    await waitFor(() => expect(screen.getByLabelText('nodes.pdf_next')).toBeDisabled());
  });

  it('页码超出总页数时夹回范围内', async () => {
    renderNode(node({ pdfPage: 999 }));
    await waitFor(() =>
      expect(screen.getByText('nodes.pdf_page_of:{"page":5,"total":5}')).toBeInTheDocument(),
    );
  });

  it('没有选区时摘录整页', async () => {
    renderNode();
    await waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());

    fireEvent.click(screen.getByText('nodes.pdf_extract'));
    await waitFor(() => expect(onExtract).toHaveBeenCalledWith('整页的文字'));
  });

  it('有选区时只摘选中的部分', async () => {
    const getSelection = vi.spyOn(window, 'getSelection');
    getSelection.mockReturnValue({ toString: () => '  选中的这一段  ' } as Selection);

    renderNode();
    await waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());

    fireEvent.click(screen.getByText('nodes.pdf_extract'));
    await waitFor(() => expect(onExtract).toHaveBeenCalledWith('选中的这一段'));
    expect(pdfPageText).not.toHaveBeenCalled();

    getSelection.mockRestore();
  });

  it('文件打不开时显示原因而不是一直转圈', async () => {
    loadPdfDocument.mockRejectedValue(new Error('broken'));
    renderNode();
    await waitFor(() => expect(screen.getByText('nodes.pdf_failed')).toBeInTheDocument());
  });

  it('渲染文字层，否则「摘录选中部分」无从谈起', async () => {
    renderNode();
    await waitFor(() => expect(renderPdfTextLayer).toHaveBeenCalled());
  });
});
