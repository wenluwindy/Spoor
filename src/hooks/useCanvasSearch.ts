import React, { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Canvas, type CanvasNode } from '../db';
import { nodeMatchesSearch, searchCanvasNodes, type CanvasSearchMatch } from '../utils/canvasSearch';

export interface OtherCanvasSearchResult {
  canvasId: string;
  canvasName: string;
  count: number;
}

/**
 * 画布内搜索（Ctrl+F）的状态与查询（从 App 抽出来，0.3.x 里这段住在 App 本体）。
 *
 * 命中判定是纯函数（`utils/canvasSearch`），这里只管状态与数据：
 * 当前画布的命中列表、跨画布的聚合计数、以及"搜索词一变回到第一条"这类节奏。
 * 视口跳转（focusNode）留在调用方——那是 DOM 与 transform 的事。
 */
export function useCanvasSearch(params: {
  dynamicNodes: CanvasNode[];
  activeCanvasId: string;
  canvases: Canvas[];
  agentNameById: (agentConfigId: string | undefined) => string | undefined;
  /** 当前命中项变化时把视口跟过去。 */
  onFocusMatch: (nodeId: string) => void;
}) {
  const { dynamicNodes, activeCanvasId, canvases, agentNameById, onFocusMatch } = params;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  const searchMatches: CanvasSearchMatch[] = React.useMemo(
    () => searchCanvasNodes(dynamicNodes, searchQuery, { agentNameById }),
    [dynamicNodes, searchQuery, agentNameById],
  );

  /**
   * 跨画布命中数。三个省钱的点：
   * - `useDeferredValue`：连续敲字时只按最后一版查询扫库，不是每个字符一遍；
   * - `where('canvasId').notEqual(...)`：走索引跳过当前画布，且当前画布上的
   *   流式 AI 写入不会触发这个 live query 重跑；
   * - `each` 逐行数命中，不把全库节点物化成一个大数组再过滤。
   */
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const otherCanvasSearchResults: OtherCanvasSearchResult[] =
    useLiveQuery(async () => {
      const needle = deferredSearchQuery.trim().toLowerCase();
      if (!isSearchOpen || needle === '') return [];
      const counts = new Map<string, number>();
      await db.nodes.where('canvasId').notEqual(activeCanvasId).each((n) => {
        if (nodeMatchesSearch(n, needle, agentNameById(n.agentConfigId))) {
          const owner = n.canvasId || 'default';
          counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
      });
      return [...counts.entries()].map(([canvasId, count]) => ({
        canvasId,
        canvasName: canvases.find((c) => c.id === canvasId)?.name ?? canvasId,
        count,
      }));
    }, [isSearchOpen, deferredSearchQuery, activeCanvasId, canvases, agentNameById]) || [];

  // 搜索词一变（或换了画布）就回到第一条命中
  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery, activeCanvasId]);

  // 当前命中项换了就把视口跟过去
  useEffect(() => {
    if (!isSearchOpen) return;
    const match = searchMatches[searchIndex];
    if (!match) return;
    onFocusMatch(match.nodeId);
    // onFocusMatch 是调用方的 useCallback；这里刻意不因它重跳（跳转由命中项驱动）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchOpen, searchMatches, searchIndex]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchIndex,
    setSearchIndex,
    searchMatches,
    otherCanvasSearchResults,
    closeSearch,
  };
}
