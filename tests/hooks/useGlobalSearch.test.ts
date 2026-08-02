import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db, type Canvas, type ResearchSession } from '../../src/db';
import {
  EMPTY_GLOBAL_SEARCH_RESULTS,
  articleSearchFields,
  firstMatchingField,
  flattenGlobalSearchRows,
  researchSearchFields,
  runGlobalSearch,
  useGlobalSearch,
} from '../../src/hooks/useGlobalSearch';

const canvases: Canvas[] = [
  { id: 'c1', name: '灵感墙', createdAt: 1, updatedAt: 1 },
  { id: 'c2', name: '项目推进', createdAt: 1, updatedAt: 1 },
];

function node(id: string, canvasId: string, content: string, extra: Record<string, unknown> = {}) {
  return { id, canvasId, type: 'text', content, x: 0, y: 0, ...extra };
}

function session(id: string, query: string, intro = ''): ResearchSession {
  return {
    id,
    query,
    createdAt: 1,
    updatedAt: 1,
    researchPlan: [],
    researchReport: { intro, points: [{ title: '要点一', text: '要点正文' }], conclusion: '' },
    sourceCount: 0,
    searchStatus: 'idle',
  };
}

describe('useGlobalSearch', () => {
  beforeEach(async () => {
    await Promise.all([db.nodes.clear(), db.articles.clear(), db.researchSessions.clear()]);
  });

  describe('纯匹配逻辑', () => {
    it('articleSearchFields 取标题与正文，滤掉空串', () => {
      expect(
        articleSearchFields({ id: 'a1', title: '量子纠缠', content: '正文', date: '', type: 'article' }),
      ).toEqual(['量子纠缠', '正文']);
      expect(
        articleSearchFields({ id: 'a2', title: '  ', content: '', date: '', type: 'article' }),
      ).toEqual([]);
    });

    it('researchSearchFields 覆盖研究主题与报告全文（引言/要点/结论）', () => {
      const fields = researchSearchFields(session('s1', '主题', '引言'));
      expect(fields).toEqual(['主题', '引言', '要点一', '要点正文']);
    });

    it('firstMatchingField 不区分大小写，空查询不命中', () => {
      expect(firstMatchingField(['Alpha', 'beta'], 'alp')).toBe('Alpha');
      expect(firstMatchingField(['Alpha'], '')).toBeUndefined();
      expect(firstMatchingField([], 'x')).toBeUndefined();
    });
  });

  describe('runGlobalSearch（fake-indexeddb 流式扫描）', () => {
    it('三路各自命中，画布结果按画布聚合并带画布名', async () => {
      await db.nodes.bulkAdd([
        node('n1', 'c1', '量子力学笔记'),
        node('n2', 'c2', '量子计算路线图'),
        node('n3', 'c2', '无关内容'),
      ]);
      await db.articles.bulkAdd([
        { id: 'a1', title: '量子纠缠综述', content: '……', date: '', type: 'article' },
        { id: 'a2', title: '别的', content: '正文里也提到量子', date: '', type: 'article' },
        { id: 'a3', title: '完全无关', content: '……', date: '', type: 'article' },
      ]);
      await db.researchSessions.bulkAdd([
        session('s1', '量子退火研究'),
        session('s2', '别的主题', '报告引言里出现了量子这个词'),
        session('s3', '毫不相干'),
      ]);

      const results = await runGlobalSearch('量子', { canvases });

      expect(results.canvasGroups.map((g) => g.canvasName).sort()).toEqual(['灵感墙', '项目推进']);
      const c2 = results.canvasGroups.find((g) => g.canvasId === 'c2');
      expect(c2?.hits.map((h) => h.nodeId)).toEqual(['n2']);
      expect(c2?.hits[0].snippet).toContain('量子');

      expect(results.articles.map((a) => a.articleId).sort()).toEqual(['a1', 'a2']);
      expect(results.research.map((r) => r.sessionId).sort()).toEqual(['s1', 's2']);
      // s2 是报告文本命中，摘要来自命中字段而不是研究主题
      expect(results.research.find((r) => r.sessionId === 's2')?.snippet).toContain('报告引言');
      expect(results.nodesOverflow).toBe(0);
    });

    it('画布名找不到时退回 canvasId；Agent 卡靠人设名命中', async () => {
      await db.nodes.bulkAdd([
        node('g1', 'ghost-canvas', '量子'),
        { id: 'ag1', canvasId: 'c1', type: 'agent', agentConfigId: 'cfg1', x: 0, y: 0 },
      ]);

      const results = await runGlobalSearch('考据癖', {
        canvases,
        agentNameById: (id) => (id === 'cfg1' ? '考据癖' : undefined),
      });
      expect(results.canvasGroups).toHaveLength(1);
      expect(results.canvasGroups[0].hits[0].nodeId).toBe('ag1');

      const ghost = await runGlobalSearch('量子', {});
      expect(ghost.canvasGroups[0].canvasName).toBe('ghost-canvas');
    });

    it('查询不区分大小写', async () => {
      await db.nodes.add(node('n1', 'c1', 'Quantum Computing'));
      const results = await runGlobalSearch('qUaNtUm', { canvases });
      expect(results.canvasGroups[0]?.hits).toHaveLength(1);
    });

    it('每路截断在上限并统计「还有 N 条」', async () => {
      await db.nodes.bulkAdd([
        node('n1', 'c1', '量子一'),
        node('n2', 'c1', '量子二'),
        node('n3', 'c2', '量子三'),
      ]);
      await db.articles.bulkAdd([
        { id: 'a1', title: '量子甲', content: '', date: '', type: 'article' },
        { id: 'a2', title: '量子乙', content: '', date: '', type: 'article' },
        { id: 'a3', title: '量子丙', content: '', date: '', type: 'article' },
      ]);

      const results = await runGlobalSearch('量子', { canvases, limit: 2 });

      const keptNodes = results.canvasGroups.reduce((acc, g) => acc + g.hits.length, 0);
      expect(keptNodes).toBe(2);
      expect(results.nodesOverflow).toBe(1);
      expect(results.articles).toHaveLength(2);
      expect(results.articlesOverflow).toBe(1);
      expect(results.researchOverflow).toBe(0);
    });

    it('空查询与纯空白查询返回稳定的空结果', async () => {
      await db.nodes.add(node('n1', 'c1', '量子'));
      expect(await runGlobalSearch('', {})).toBe(EMPTY_GLOBAL_SEARCH_RESULTS);
      expect(await runGlobalSearch('   ', {})).toBe(EMPTY_GLOBAL_SEARCH_RESULTS);
    });
  });

  it('flattenGlobalSearchRows 的行序：画布组 → 长文 → 研究，与面板渲染一致', () => {
    const rows = flattenGlobalSearchRows({
      canvasGroups: [
        { canvasId: 'c1', canvasName: 'C1', hits: [{ nodeId: 'n1', canvasId: 'c1', snippet: '' }] },
        { canvasId: 'c2', canvasName: 'C2', hits: [{ nodeId: 'n2', canvasId: 'c2', snippet: '' }] },
      ],
      nodesOverflow: 0,
      articles: [{ articleId: 'a1', title: '', snippet: '' }],
      articlesOverflow: 0,
      research: [{ sessionId: 's1', query: '', snippet: '' }],
      researchOverflow: 0,
    });
    expect(rows).toEqual([
      { kind: 'node', canvasId: 'c1', nodeId: 'n1' },
      { kind: 'node', canvasId: 'c2', nodeId: 'n2' },
      { kind: 'article', articleId: 'a1' },
      { kind: 'research', sessionId: 's1' },
    ]);
  });

  describe('useGlobalSearch hook', () => {
    it('敲词后（防抖）出结果，键盘位置在行序里循环移动', async () => {
      await db.nodes.add(node('n1', 'c1', '量子力学'));
      await db.articles.add({ id: 'a1', title: '量子纠缠', content: '', date: '', type: 'article' });

      const { result } = renderHook(() => useGlobalSearch({ canvases }));
      expect(result.current.rows).toEqual([]);

      act(() => result.current.setQuery('量子'));
      await waitFor(() => expect(result.current.rows).toHaveLength(2));

      expect(result.current.activeIndex).toBe(0);
      act(() => result.current.moveActive(1));
      expect(result.current.activeIndex).toBe(1);
      // 到底再往下回到第一条；到顶再往上绕到最后一条
      act(() => result.current.moveActive(1));
      expect(result.current.activeIndex).toBe(0);
      act(() => result.current.moveActive(-1));
      expect(result.current.activeIndex).toBe(1);
    });

    it('查询一变回到第一条', async () => {
      await db.nodes.bulkAdd([node('n1', 'c1', '量子一'), node('n2', 'c1', '量子二')]);

      const { result } = renderHook(() => useGlobalSearch({ canvases }));
      act(() => result.current.setQuery('量子'));
      await waitFor(() => expect(result.current.rows).toHaveLength(2));

      act(() => result.current.moveActive(1));
      expect(result.current.activeIndex).toBe(1);

      act(() => result.current.setQuery('量子一'));
      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.activeIndex).toBe(0);
    });
  });
});
