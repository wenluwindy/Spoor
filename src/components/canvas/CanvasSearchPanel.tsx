import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

export interface OtherCanvasSearchResult {
  canvasId: string;
  canvasName: string;
  count: number;
}

export interface CanvasSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** 当前画布的命中数。 */
  matchCount: number;
  /** 0 起的当前位置；没有命中时忽略。 */
  activeIndex: number;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
  /** 别的画布里的命中，按画布聚合。 */
  otherCanvases: OtherCanvasSearchResult[];
  onOpenCanvas: (canvasId: string) => void;
}

/**
 * Ctrl+F 搜索条。
 *
 * 只负责显示与按键，命中判定和视口跳转都在 App 那边——这样搜索逻辑是纯函数
 * （见 `utils/canvasSearch`），能单独测。
 *
 * 跨画布结果按**画布**聚合而不是逐条列出：多画布场景下真正的问题是"这东西在哪张画布"，
 * 至于是那张画布上的第几张卡，切过去接着按回车就找到了。
 */
export function CanvasSearchPanel({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onStep,
  onClose,
  otherCanvases,
  onOpenCanvas,
}: CanvasSearchPanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const hasQuery = query.trim() !== '';

  return (
    <div
      data-canvas-search=""
      className="absolute top-6 left-1/2 -translate-x-1/2 z-50 w-[min(28rem,calc(100%-3rem))]"
    >
      <div className="bg-app-surface-raised border border-app-border rounded-2xl shadow-lg px-3 py-2 flex items-center gap-2">
        <Search className="w-4 h-4 text-app-text-faint shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={t('canvas.search.placeholder')}
          className="flex-1 min-w-0 bg-transparent font-sans text-sm text-app-text placeholder:text-app-text-faint focus:outline-none"
        />
        <span className="font-sans text-xs text-app-text-faint tabular-nums shrink-0">
          {!hasQuery
            ? ''
            : matchCount === 0
              ? t('canvas.search.no_match')
              : t('canvas.search.position', { index: activeIndex + 1, total: matchCount })}
        </span>
        <Tooltip label={t('canvas.search.previous')}>
          <button
            onClick={() => onStep(-1)}
            disabled={matchCount === 0}
            className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={t('canvas.search.next')}>
          <button
            onClick={() => onStep(1)}
            disabled={matchCount === 0}
            className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={t('canvas.search.close')}>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {hasQuery && otherCanvases.length > 0 && (
        <div className="mt-2 bg-app-surface-raised border border-app-border rounded-2xl shadow-lg overflow-hidden">
          <div className="px-3 pt-2 pb-1 font-sans text-[11px] uppercase tracking-widest text-app-text-faint">
            {t('canvas.search.other_canvases')}
          </div>
          {otherCanvases.map((row) => (
            <button
              key={row.canvasId}
              onClick={() => onOpenCanvas(row.canvasId)}
              className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-app-surface-subtle transition-colors"
            >
              <span className="font-sans text-sm text-app-text truncate">{row.canvasName}</span>
              <span className="font-sans text-xs text-app-text-faint tabular-nums shrink-0">
                {t('canvas.search.match_count', { count: row.count })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
