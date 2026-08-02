import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, FlaskConical, Search, StickyNote, X } from 'lucide-react';
import type { Canvas } from '../db';
import {
  useGlobalSearch,
  type GlobalSearchRow,
} from '../hooks/useGlobalSearch';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../services/keyboardLayers';
import { Tooltip } from './ui/Tooltip';

/**
 * 全局搜索覆盖层（Ctrl+Shift+F）。
 *
 * 只负责显示与按键：数据三路扫描住在 `hooks/useGlobalSearch`，选中后的跳转
 * 通过回调上抛给 App（切画布 / 开长文 / 进实验室都是 App 的事，面板不碰路由状态）。
 *
 * 键盘约定与画布内搜索一脉相承：↑↓ 在**全部**结果里移动（跨分组连续），
 * Enter 打开当前行，Esc 关闭。
 */

export interface GlobalSearchPanelProps {
  canvases: Canvas[];
  agentNameById?: (agentConfigId: string | undefined) => string | undefined;
  onOpenCanvasNode: (canvasId: string, nodeId: string) => void;
  onOpenArticle: (articleId: string) => void;
  onOpenResearch: (sessionId: string) => void;
  onClose: () => void;
}

/** 行的稳定标识，把渲染位置对回扁平键盘序。 */
function rowKey(row: GlobalSearchRow): string {
  switch (row.kind) {
    case 'node':
      return `node:${row.canvasId}:${row.nodeId}`;
    case 'article':
      return `article:${row.articleId}`;
    case 'research':
      return `research:${row.sessionId}`;
  }
}

/** 命中片段高亮：只标第一处，与摘要截取（buildSnippet）的锚点一致。 */
function highlightText(text: string, needle: string): React.ReactNode {
  const q = needle.trim();
  if (q === '') return text;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-app-accent/15 text-app-accent rounded-[2px] px-px">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

function GroupHeader({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-widest text-app-text-faint">
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {children}
    </div>
  );
}

export function GlobalSearchPanel({
  canvases,
  agentNameById,
  onOpenCanvasNode,
  onOpenArticle,
  onOpenResearch,
  onClose,
}: GlobalSearchPanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { query, setQuery, deferredQuery, results, rows, activeIndex, setActiveIndex, moveActive } =
    useGlobalSearch({ canvases, agentNameById });

  const indexByKey = useMemo(
    () => new Map(rows.map((row, index) => [rowKey(row), index])),
    [rows],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 面板在场即占 'search' 层：压住演示/拉线/菜单/画布的 Esc，只让位给对话框
  useEffect(() => acquireKeyboardLayer('search'), []);

  // 键盘移动时把当前行滚进可视区
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openRow = (row: GlobalSearchRow) => {
    switch (row.kind) {
      case 'node':
        onOpenCanvasNode(row.canvasId, row.nodeId);
        break;
      case 'article':
        onOpenArticle(row.articleId);
        break;
      case 'research':
        onOpenResearch(row.sessionId);
        break;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // 面板之上还压着对话框时这下 Esc 归对话框
      if (!isTopKeyboardLayer('search')) return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) openRow(row);
    }
  };

  const hasQuery = deferredQuery.trim() !== '';
  const hasResults = rows.length > 0;

  /** 单条结果行。可见文字由调用处传入；高亮统一走 highlightText。 */
  const resultRow = (row: GlobalSearchRow, children: React.ReactNode) => {
    const key = rowKey(row);
    const index = indexByKey.get(key) ?? 0;
    const active = index === activeIndex;
    return (
      <button
        key={key}
        type="button"
        data-active={active || undefined}
        onClick={() => openRow(row)}
        onMouseMove={() => setActiveIndex(index)}
        className={`w-full px-4 py-2 flex flex-col items-start gap-0.5 text-left transition-colors ${
          active ? 'bg-app-surface-subtle' : 'hover:bg-app-surface-subtle'
        }`}
      >
        {children}
      </button>
    );
  };

  return (
    <div
      data-global-search=""
      role="presentation"
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh] bg-black/20 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('app.global_search.title')}
        className="w-full max-w-2xl max-h-[70vh] flex flex-col bg-app-surface-raised border border-app-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* 输入行 */}
        <div className="px-4 py-3 flex items-center gap-2 border-b border-app-surface-subtle">
          <Search className="w-4 h-4 text-app-text-faint shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('app.global_search.placeholder')}
            className="flex-1 min-w-0 bg-transparent font-sans text-sm text-app-text placeholder:text-app-text-faint focus:outline-none"
          />
          <Tooltip label={t('app.global_search.close')}>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-2">
          {hasQuery && !hasResults && (
            <p className="px-4 py-6 text-center font-sans text-sm text-app-text-faint">
              {t('app.global_search.no_results')}
            </p>
          )}

          {results.canvasGroups.length > 0 && (
            <section>
              <GroupHeader icon={StickyNote}>{t('app.global_search.group_canvas')}</GroupHeader>
              {results.canvasGroups.map((group) => (
                <div key={group.canvasId}>
                  <div className="px-4 pt-1.5 pb-0.5 font-sans text-xs font-bold text-app-text-muted truncate">
                    {group.canvasName}
                  </div>
                  {group.hits.map((hit) =>
                    resultRow(
                      { kind: 'node', canvasId: group.canvasId, nodeId: hit.nodeId },
                      <span className="font-sans text-sm text-app-text-soft line-clamp-2">
                        {highlightText(hit.snippet, deferredQuery)}
                      </span>,
                    ),
                  )}
                </div>
              ))}
              {results.nodesOverflow > 0 && (
                <div className="px-4 py-1.5 font-sans text-xs text-app-text-faint">
                  {t('app.global_search.more', { count: results.nodesOverflow })}
                </div>
              )}
            </section>
          )}

          {results.articles.length > 0 && (
            <section>
              <GroupHeader icon={BookOpen}>{t('app.global_search.group_articles')}</GroupHeader>
              {results.articles.map((hit) =>
                resultRow(
                  { kind: 'article', articleId: hit.articleId },
                  <>
                    <span className="font-sans text-sm font-bold text-app-text truncate w-full">
                      {highlightText(hit.title, deferredQuery)}
                    </span>
                    <span className="font-sans text-xs text-app-text-muted line-clamp-2">
                      {highlightText(hit.snippet, deferredQuery)}
                    </span>
                  </>,
                ),
              )}
              {results.articlesOverflow > 0 && (
                <div className="px-4 py-1.5 font-sans text-xs text-app-text-faint">
                  {t('app.global_search.more', { count: results.articlesOverflow })}
                </div>
              )}
            </section>
          )}

          {results.research.length > 0 && (
            <section>
              <GroupHeader icon={FlaskConical}>{t('app.global_search.group_research')}</GroupHeader>
              {results.research.map((hit) =>
                resultRow(
                  { kind: 'research', sessionId: hit.sessionId },
                  <>
                    <span className="font-sans text-sm font-bold text-app-text truncate w-full">
                      {highlightText(hit.query, deferredQuery)}
                    </span>
                    <span className="font-sans text-xs text-app-text-muted line-clamp-2">
                      {highlightText(hit.snippet, deferredQuery)}
                    </span>
                  </>,
                ),
              )}
              {results.researchOverflow > 0 && (
                <div className="px-4 py-1.5 font-sans text-xs text-app-text-faint">
                  {t('app.global_search.more', { count: results.researchOverflow })}
                </div>
              )}
            </section>
          )}
        </div>

        {/* 键位提示 */}
        <div className="px-4 py-2 border-t border-app-surface-subtle font-sans text-[11px] text-app-text-faint">
          {t('app.global_search.hint')}
        </div>
      </div>
    </div>
  );
}
