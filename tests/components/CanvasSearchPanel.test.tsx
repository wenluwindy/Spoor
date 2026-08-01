import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasSearchPanel } from '../../src/components/canvas/CanvasSearchPanel';

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

describe('CanvasSearchPanel', () => {
  const props = {
    query: '',
    onQueryChange: vi.fn(),
    matchCount: 0,
    activeIndex: 0,
    onStep: vi.fn(),
    onClose: vi.fn(),
    otherCanvases: [],
    onOpenCanvas: vi.fn(),
  };

  beforeEach(() => {
    props.onQueryChange.mockClear();
    props.onStep.mockClear();
    props.onClose.mockClear();
    props.onOpenCanvas.mockClear();
  });

  const input = () => screen.getByPlaceholderText('canvas.search.placeholder');

  it('打开就把焦点放进输入框，不必再点一下', () => {
    render(<CanvasSearchPanel {...props} />);
    expect(document.activeElement).toBe(input());
  });

  it('输入时把查询词交出去', () => {
    render(<CanvasSearchPanel {...props} />);
    fireEvent.change(input(), { target: { value: '创作者' } });
    expect(props.onQueryChange).toHaveBeenCalledWith('创作者');
  });

  it('Enter 下一个、Shift+Enter 上一个、Esc 关闭', () => {
    render(<CanvasSearchPanel {...props} query="甲" matchCount={3} />);
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(props.onStep.mock.calls).toEqual([[1], [-1]]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('有命中时显示第几个/共几个', () => {
    render(<CanvasSearchPanel {...props} query="甲" matchCount={7} activeIndex={2} />);
    // activeIndex 是 0 起，显示要 +1
    expect(screen.getByText('canvas.search.position:{"index":3,"total":7}')).toBeInTheDocument();
  });

  it('没有命中时显示无结果，且上下切换禁用', () => {
    render(<CanvasSearchPanel {...props} query="找不到" matchCount={0} />);
    expect(screen.getByText('canvas.search.no_match')).toBeInTheDocument();
    expect(screen.getByLabelText('canvas.search.next')).toBeDisabled();
    expect(screen.getByLabelText('canvas.search.previous')).toBeDisabled();
  });

  it('没输入查询词时不显示计数', () => {
    render(<CanvasSearchPanel {...props} query="" matchCount={0} />);
    expect(screen.queryByText('canvas.search.no_match')).not.toBeInTheDocument();
  });

  it('列出别的画布的命中并支持跳过去', () => {
    render(
      <CanvasSearchPanel
        {...props}
        query="甲"
        otherCanvases={[{ canvasId: 'c2', canvasName: '第二张画布', count: 4 }]}
      />,
    );
    expect(screen.getByText('canvas.search.match_count:{"count":4}')).toBeInTheDocument();

    fireEvent.click(screen.getByText('第二张画布'));
    expect(props.onOpenCanvas).toHaveBeenCalledWith('c2');
  });

  it('查询词为空时不列出跨画布结果', () => {
    render(
      <CanvasSearchPanel
        {...props}
        query=""
        otherCanvases={[{ canvasId: 'c2', canvasName: '第二张画布', count: 4 }]}
      />,
    );
    expect(screen.queryByText('第二张画布')).not.toBeInTheDocument();
  });

  it('关闭按钮触发 onClose', () => {
    render(<CanvasSearchPanel {...props} />);
    fireEvent.click(screen.getByLabelText('canvas.search.close'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
