import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  metasoSearch,
  webSearch,
  mapTavilyResults,
  buildSearchContext,
} from '../../src/services/search';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('metasoSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSearchContext', () => {
    it('empty webpages returns empty string', () => {
      const result = buildSearchContext({ credits: 0, total: 0, webpages: [] });
      expect(result).toBe('');
    });

    it('formats webpages into context block', () => {
      const result = buildSearchContext({
        credits: 1,
        total: 2,
        webpages: [
          { title: 'Article A', link: 'https://a.com', snippet: 'Snippet A', score: 'high', date: '2026-01-01' },
          { title: 'Article B', link: 'https://b.com', snippet: 'Snippet B', score: 'medium', date: '2026-02-01' },
        ],
      });
      expect(result).toContain('[Source 1: Article A](https://a.com)');
      expect(result).toContain('Snippet A');
      expect(result).toContain('[Source 2: Article B](https://b.com)');
      expect(result).toContain('Snippet B');
      expect(result).toContain('--- Web search results ---');
      expect(result).toContain('--- End of search results ---');
    });

    it('handles missing webpages array gracefully', () => {
      const result = buildSearchContext({ credits: 0, total: 0 } as any);
      expect(result).toBe('');
    });
  });

  describe('metasoSearch - browser path', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('throws on empty API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '' })
      ).rejects.toThrow('search.no_key');
    });

    it('throws on whitespace-only API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '   ' })
      ).rejects.toThrow('search.no_key');
    });

    it('calls Vite proxy endpoint with correct params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          credits: 1,
          total: 1,
          webpages: [{ title: 'Test', link: 'https://test.com', snippet: 'Hello', score: 'high', date: '2026-01-01' }],
        }),
      });

      const result = await metasoSearch('AI research', { apiKey: 'sk-metaso-test' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-metaso-test',
          },
          body: JSON.stringify({ q: 'AI research', scope: 'webpage', size: 5 }),
        })
      );
      expect(result.webpages).toHaveLength(1);
      expect(result.webpages[0].title).toBe('Test');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        metasoSearch('test', { apiKey: 'bad-key' })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'search.failed', detail: expect.stringContaining('401') }),
      );
    });
  });
});

describe('Tavily 适配', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('results[] 映射成归一后的 webpages[]', () => {
    const mapped = mapTavilyResults({
      query: 'x',
      results: [
        {
          title: 'Article A',
          url: 'https://a.com',
          content: 'Snippet A',
          score: 0.93,
        },
      ],
    });

    expect(mapped.webpages).toEqual([
      { title: 'Article A', link: 'https://a.com', snippet: 'Snippet A', score: '0.93', date: '' },
    ]);
    expect(mapped.total).toBe(1);
  });

  it('news 主题带回的发布日期保留下来', () => {
    const mapped = mapTavilyResults({
      results: [{ title: 'T', url: 'https://n.com', content: 'C', published_date: '2026-07-01' }],
    });
    expect(mapped.webpages[0].date).toBe('2026-07-01');
  });

  it('缺字段与空结果都不抛', () => {
    expect(mapTavilyResults({ results: [] }).webpages).toEqual([]);
    expect(mapTavilyResults({}).webpages).toEqual([]);
    expect(mapTavilyResults(null).webpages).toEqual([]);

    const partial = mapTavilyResults({ results: [{ title: 'only title' }] });
    expect(partial.webpages[0]).toEqual({
      title: 'only title',
      link: '',
      snippet: '',
      score: '',
      date: '',
    });
  });

  it('映射结果能直接喂给 buildSearchContext', () => {
    // 归一的意义就在这里：下游一行都不用改
    const context = buildSearchContext(
      mapTavilyResults({ results: [{ title: 'A', url: 'https://a.com', content: 'S' }] }),
    );
    expect(context).toContain('[Source 1: A](https://a.com)');
    expect(context).toContain('S');
  });
});

describe('webSearch 分发', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('没有 Key 时不发请求，直接抛 search.no_key', async () => {
    await expect(webSearch('q', { kind: 'tavily', apiKey: '   ' })).rejects.toThrow(
      expect.objectContaining({ code: 'search.no_key' }),
    );
  });
});
