import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Article, type Canvas, type ResearchSession } from '../db';
import { buildSnippet, nodeSearchFields } from '../utils/canvasSearch';

/**
 * 全局搜索（Ctrl+Shift+F）的数据层：一次敲词，三路各扫一遍——
 * 画布节点（全库跨画布）、长文（标题/正文）、研究会话（研究主题与报告文本）。
 *
 * 三条省钱的约定，与画布内搜索（useCanvasSearch）同一套思路：
 * - `useDeferredValue` 防抖：连续敲字只按最后一版查询扫库；
 * - Dexie `each` 逐行流式判定，不把全库物化成大数组再过滤；
 * - 每路截断在 `GLOBAL_SEARCH_LIMIT` 条，只数不存超出的部分（「还有 N 条」）。
 *
 * 命中判定复用 `utils/canvasSearch` 的纯函数（nodeSearchFields / buildSnippet），
 * 长文与研究的字段抽取也是纯函数，单独可测。跳转不在这里做——面板把选中项
 * 通过回调上抛，由 App 决定切画布 / 开长文 / 进实验室。
 */

/** 每路结果上限。超出的只计数，显示「还有 N 条」。 */
export const GLOBAL_SEARCH_LIMIT = 50;

export interface GlobalSearchNodeHit {
  nodeId: string;
  canvasId: string;
  snippet: string;
}

/** 画布路的结果按画布聚合：跨库搜索时真正的问题是「这东西在哪张画布」。 */
export interface GlobalSearchCanvasGroup {
  canvasId: string;
  canvasName: string;
  hits: GlobalSearchNodeHit[];
}

export interface GlobalSearchArticleHit {
  articleId: string;
  title: string;
  snippet: string;
}

export interface GlobalSearchResearchHit {
  sessionId: string;
  query: string;
  snippet: string;
}

export interface GlobalSearchResults {
  canvasGroups: GlobalSearchCanvasGroup[];
  /** 画布路超过上限被截掉的条数（0 = 没截）。 */
  nodesOverflow: number;
  articles: GlobalSearchArticleHit[];
  articlesOverflow: number;
  research: GlobalSearchResearchHit[];
  researchOverflow: number;
}

/** 稳定引用的空结果：查询为空、扫描未完成时都用它，避免下游 memo 反复失效。 */
export const EMPTY_GLOBAL_SEARCH_RESULTS: GlobalSearchResults = {
  canvasGroups: [],
  nodesOverflow: 0,
  articles: [],
  articlesOverflow: 0,
  research: [],
  researchOverflow: 0,
};

/** 长文参与搜索的字段：标题优先（摘要从靠前字段取）。 */
export function articleSearchFields(article: Article): string[] {
  return [article.title ?? '', article.content ?? ''].filter((s) => s.trim() !== '');
}

/** 研究会话参与搜索的字段：研究主题 + 报告全文（引言、各要点、结论）。 */
export function researchSearchFields(session: ResearchSession): string[] {
  const report = session.researchReport;
  return [
    session.query ?? '',
    report?.intro ?? '',
    ...(report?.points ?? []).flatMap((p) => [p.title ?? '', p.text ?? '']),
    report?.conclusion ?? '',
  ].filter((s) => s.trim() !== '');
}

/** 第一个命中的字段（`needle` 必须已 trim + toLowerCase），没命中返回 undefined。 */
export function firstMatchingField(fields: string[], needle: string): string | undefined {
  if (!needle) return undefined;
  return fields.find((f) => f.toLowerCase().includes(needle));
}

export interface RunGlobalSearchOptions {
  /** 画布名从这里查；查不到时退回显示 canvasId。 */
  canvases?: Canvas[];
  /** Agent 卡自己没有正文，名字要从人设表里查（与画布内搜索一致）。 */
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
  /** 每路上限，默认 GLOBAL_SEARCH_LIMIT；测试用小值验证截断。 */
  limit?: number;
}

/**
 * 三路扫库（可独立于 React 调用与测试）。空查询返回稳定的空结果。
 */
export async function runGlobalSearch(
  query: string,
  options: RunGlobalSearchOptions = {},
): Promise<GlobalSearchResults> {
  const needle = query.trim().toLowerCase();
  if (needle === '') return EMPTY_GLOBAL_SEARCH_RESULTS;
  const limit = options.limit ?? GLOBAL_SEARCH_LIMIT;

  // ── 画布节点：全库流式扫，按画布聚合 ──
  const groupsById = new Map<string, GlobalSearchCanvasGroup>();
  let nodeHitCount = 0;
  await db.nodes.each((node) => {
    const hit = firstMatchingField(
      nodeSearchFields(node, options.agentNameById?.(node.agentConfigId)),
      needle,
    );
    if (hit === undefined) return;
    nodeHitCount += 1;
    if (nodeHitCount > limit) return; // 只计数，不再存
    const canvasId = node.canvasId || 'default';
    let group = groupsById.get(canvasId);
    if (!group) {
      group = {
        canvasId,
        canvasName: options.canvases?.find((c) => c.id === canvasId)?.name ?? canvasId,
        hits: [],
      };
      groupsById.set(canvasId, group);
    }
    group.hits.push({ nodeId: node.id, canvasId, snippet: buildSnippet(hit, query) });
  });

  // ── 长文 ──
  const articles: GlobalSearchArticleHit[] = [];
  let articleHitCount = 0;
  await db.articles.each((article) => {
    const hit = firstMatchingField(articleSearchFields(article), needle);
    if (hit === undefined) return;
    articleHitCount += 1;
    if (articleHitCount > limit) return;
    articles.push({
      articleId: article.id,
      title: article.title,
      snippet: buildSnippet(hit, query),
    });
  });

  // ── 研究会话 ──
  const research: GlobalSearchResearchHit[] = [];
  let researchHitCount = 0;
  await db.researchSessions.each((session) => {
    const hit = firstMatchingField(researchSearchFields(session), needle);
    if (hit === undefined) return;
    researchHitCount += 1;
    if (researchHitCount > limit) return;
    research.push({
      sessionId: session.id,
      query: session.query,
      snippet: buildSnippet(hit, query),
    });
  });

  return {
    canvasGroups: [...groupsById.values()],
    nodesOverflow: Math.max(0, nodeHitCount - limit),
    articles,
    articlesOverflow: Math.max(0, articleHitCount - limit),
    research,
    researchOverflow: Math.max(0, researchHitCount - limit),
  };
}

/** 键盘上下移动走的扁平行序：画布组（按组序）→ 长文 → 研究，与面板渲染顺序一致。 */
export type GlobalSearchRow =
  | { kind: 'node'; canvasId: string; nodeId: string }
  | { kind: 'article'; articleId: string }
  | { kind: 'research'; sessionId: string };

export function flattenGlobalSearchRows(results: GlobalSearchResults): GlobalSearchRow[] {
  return [
    ...results.canvasGroups.flatMap((group) =>
      group.hits.map((hit) => ({
        kind: 'node' as const,
        canvasId: group.canvasId,
        nodeId: hit.nodeId,
      })),
    ),
    ...results.articles.map((a) => ({ kind: 'article' as const, articleId: a.articleId })),
    ...results.research.map((r) => ({ kind: 'research' as const, sessionId: r.sessionId })),
  ];
}

/**
 * 全局搜索的状态 hook：查询词（含防抖）、三路结果、键盘选中位置。
 * 面板（GlobalSearchPanel）只管显示与按键分派。
 */
export function useGlobalSearch(params: {
  canvases: Canvas[];
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
}) {
  const { canvases, agentNameById } = params;
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const results =
    useLiveQuery(
      () => runGlobalSearch(deferredQuery, { canvases, agentNameById }),
      [deferredQuery, canvases, agentNameById],
    ) ?? EMPTY_GLOBAL_SEARCH_RESULTS;

  const rows = useMemo(() => flattenGlobalSearchRows(results), [results]);

  const [activeIndex, setActiveIndex] = useState(0);

  // 查询一变回到第一条；结果变少时别停在越界的位置
  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);
  useEffect(() => {
    setActiveIndex((prev) => (prev >= rows.length ? 0 : prev));
  }, [rows.length]);

  const moveActive = useCallback(
    (step: 1 | -1) => {
      setActiveIndex((prev) =>
        rows.length === 0 ? 0 : (((prev + step) % rows.length) + rows.length) % rows.length,
      );
    },
    [rows.length],
  );

  return {
    query,
    setQuery,
    /** 结果实际对应的查询词（防抖后），面板用它做高亮。 */
    deferredQuery,
    results,
    rows,
    activeIndex,
    setActiveIndex,
    moveActive,
  };
}
