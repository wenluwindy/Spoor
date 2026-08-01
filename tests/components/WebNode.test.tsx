import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebNode } from '../../src/components/nodes/WebNode';
import type { CanvasNode } from '../../src/db';

const openExternalUrl = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

vi.mock('../../src/utils/openExternal', () => ({ openExternalUrl }));

const node = (extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'web',
  x: 0,
  y: 0,
  ...extra,
});

describe('WebNode', () => {
  const onFetch = vi.fn();

  beforeEach(() => {
    onFetch.mockClear();
    openExternalUrl.mockClear();
  });

  const renderNode = (n: CanvasNode, props: Partial<React.ComponentProps<typeof WebNode>> = {}) =>
    render(
      <WebNode node={n} editingNodeId={null} setEditingNodeId={vi.fn()} onFetch={onFetch} {...props} />,
    );

  describe('还没填地址', () => {
    it('卡片本身就是输入框，不用另开对话框', () => {
      renderNode(node());
      expect(screen.getByPlaceholderText('nodes.web_url_placeholder')).toBeInTheDocument();
    });

    it('回车触发抓取', () => {
      renderNode(node());
      const input = screen.getByPlaceholderText('nodes.web_url_placeholder');
      fireEvent.change(input, { target: { value: 'https://example.com' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onFetch).toHaveBeenCalledWith('https://example.com');
    });

    it('空地址不触发抓取', () => {
      renderNode(node());
      const input = screen.getByPlaceholderText('nodes.web_url_placeholder');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onFetch).not.toHaveBeenCalled();
    });
  });

  describe('抓到之后', () => {
    const fetched = node({
      url: 'https://example.com/post',
      urlTitle: '一篇文章',
      urlSiteName: '示例站',
      urlExcerpt: '这是摘要。',
    });

    it('显示标题、站点与摘要', () => {
      renderNode(fetched);
      expect(screen.getByText('一篇文章')).toBeInTheDocument();
      expect(screen.getByText('示例站')).toBeInTheDocument();
      expect(screen.getByText('这是摘要。')).toBeInTheDocument();
    });

    it('摘要带上下文标记，能进 AI 上下文', () => {
      const { container } = renderNode(fetched);
      const marked = container.querySelector('[data-canvas-node-context-text]');
      expect(marked?.textContent).toBe('这是摘要。');
    });

    it('没有站点名时用域名兜底', () => {
      renderNode(node({ url: 'https://www.example.com/x', urlTitle: 't' }));
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    it('点「在浏览器中打开」走系统浏览器', () => {
      renderNode(fetched);
      fireEvent.click(screen.getByText('nodes.web_open'));
      expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/post');
    });

    it('重新抓取用的是卡片上已有的地址', () => {
      renderNode(fetched);
      fireEvent.click(screen.getByText('nodes.web_refetch'));
      expect(onFetch).toHaveBeenCalledWith('https://example.com/post');
    });

    it('封面加载失败时静默隐藏，不留破图', () => {
      const { container } = renderNode(node({ ...fetched, urlImage: 'https://x/cover.png' }));
      const img = container.querySelector('img')!;
      expect(img).toBeInTheDocument();
      fireEvent.error(img);
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('状态', () => {
    it('抓取中显示进行态', () => {
      renderNode(node({ url: 'https://example.com' }), { isFetching: true });
      expect(screen.getByText('nodes.web_fetching')).toBeInTheDocument();
    });

    it('失败时保留地址并显示原因，可以原地重试', () => {
      renderNode(node({ url: 'https://example.com', urlError: 'web.fetch_failed' }));
      expect(screen.getByText('nodes.web_fetch_failed')).toBeInTheDocument();
      fireEvent.click(screen.getByText('nodes.web_refetch'));
      expect(onFetch).toHaveBeenCalledWith('https://example.com');
    });

    it('抓取中禁用重新抓取，避免连点堆请求', () => {
      renderNode(node({ url: 'https://example.com' }), { isFetching: true });
      expect(screen.getByText('nodes.web_refetch').closest('button')).toBeDisabled();
    });
  });
});
