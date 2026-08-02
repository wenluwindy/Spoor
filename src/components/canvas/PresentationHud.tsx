import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ListOrdered, X } from 'lucide-react';
import type { CanvasNode } from '../../db';
import { nodeSearchFields } from '../../utils/canvasSearch';
import { Tooltip } from '../ui/Tooltip';

/**
 * 演示模式 HUD（B7）：底部居中的胶囊条 `‹ 3/12 ›` + 顺序面板。
 *
 * 只发指令不管画布变换：翻页/跳转/退出全部通过回调交给 `usePresentation`，
 * 视口居中由 App 的 focusNode 完成。视觉贴 CanvasToolbar 的令牌
 * （app-surface-raised / app-border / app-text-*）。
 *
 * 顺序面板改的是**草稿**：↑↓ 挪的是本地副本，点「确定」才通过 `onApplyOrder`
 * 生效——挪一半就实时改播放序，正讲着的卡会被拽来拽去。
 */

/** 顺序面板每行摘要最多保留多少字符。 */
export const PRESENTATION_SUMMARY_LENGTH = 30;

/**
 * 一张卡在顺序面板里的摘要：取"最像标题"的字段（复用画布搜索的字段顺序），
 * 压平空白后截前 30 字。没有任何文字（比如手动导入的图片）返回空串，
 * 由调用方落到「无标题」占位。
 */
export function presentationNodeSummary(node: CanvasNode | undefined): string {
  if (!node) return '';
  const source = nodeSearchFields(node)[0] ?? '';
  const flat = source.replace(/\s+/g, ' ').trim();
  return flat.length > PRESENTATION_SUMMARY_LENGTH
    ? `${flat.slice(0, PRESENTATION_SUMMARY_LENGTH)}…`
    : flat;
}

/** 数组内把 `from` 位置的元素挪到 `to`（越界原样返回）。 */
function moveItem(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface PresentationHudProps {
  active: boolean;
  /** 当前播放序（nodeId 数组）。 */
  order: string[];
  /** 0 起的当前位置。 */
  index: number;
  /** 画布节点，用于顺序面板里查每张卡的摘要。 */
  nodes: CanvasNode[];
  onPrev: () => void;
  onNext: () => void;
  onJumpTo: (index: number) => void;
  /** 顺序面板点「确定」后用新顺序继续播（接 `usePresentation.reorder`）。 */
  onApplyOrder: (order: string[]) => void;
  onExit: () => void;
}

export function PresentationHud({
  active,
  order,
  index,
  nodes,
  onPrev,
  onNext,
  onJumpTo,
  onApplyOrder,
  onExit,
}: PresentationHudProps) {
  const { t } = useTranslation();
  /** 顺序面板的草稿；null 表示面板收起。 */
  const [draft, setDraft] = useState<string[] | null>(null);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  if (!active || order.length === 0) return null;

  const summaryTextOf = (id: string) =>
    presentationNodeSummary(nodesById.get(id)) || t('canvas.presentation.untitled');

  return (
    <div
      data-presentation-hud=""
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center"
    >
      {draft !== null && (
        <div className="mb-2 w-80 bg-app-surface-raised border border-app-border rounded-2xl shadow-lg overflow-hidden">
          <div className="px-4 pt-3 pb-1 font-sans text-[11px] uppercase tracking-widest text-app-text-faint">
            {t('canvas.presentation.order_title')}
          </div>
          <ul className="max-h-64 overflow-y-auto px-2 pb-1">
            {draft.map((id, i) => (
              <li key={id} className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-app-surface-subtle transition-colors">
                <span className="w-6 shrink-0 text-right font-sans text-xs text-app-text-faint tabular-nums">
                  {i + 1}
                </span>
                <Tooltip label={t('canvas.presentation.jump_to')} skipAriaLabel>
                  <button
                    type="button"
                    onClick={() => {
                      const at = order.indexOf(id);
                      if (at >= 0) onJumpTo(at);
                    }}
                    className="flex-1 min-w-0 text-left font-sans text-sm text-app-text truncate px-1 py-1"
                  >
                    {summaryTextOf(id)}
                  </button>
                </Tooltip>
                <Tooltip label={t('canvas.presentation.move_up')}>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => setDraft((d) => (d ? moveItem(d, i, i - 1) : d))}
                    className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed shrink-0"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label={t('canvas.presentation.move_down')}>
                  <button
                    type="button"
                    disabled={i === draft.length - 1}
                    onClick={() => setDraft((d) => (d ? moveItem(d, i, i + 1) : d))}
                    className="p-1 rounded-md text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed shrink-0"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 px-3 py-2 border-t border-app-surface-subtle">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="px-3 py-1 rounded-lg font-sans text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-subtle transition-colors"
            >
              {t('canvas.presentation.cancel_order')}
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyOrder(draft);
                setDraft(null);
              }}
              className="px-3 py-1 rounded-lg font-sans text-xs font-bold bg-app-accent text-white hover:bg-app-accent-hover transition-colors"
            >
              {t('canvas.presentation.apply_order')}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 bg-app-surface-raised/95 backdrop-blur-sm border border-app-border rounded-full shadow-lg px-2 py-1.5">
        <Tooltip label={t('canvas.presentation.prev')}>
          <button
            type="button"
            onClick={onPrev}
            disabled={index <= 0}
            className="p-1.5 rounded-full text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <span className="min-w-[3.5rem] px-1 text-center font-sans text-xs font-bold text-app-text tabular-nums">
          {t('canvas.presentation.position', { index: index + 1, total: order.length })}
        </span>
        <Tooltip label={t('canvas.presentation.next')}>
          <button
            type="button"
            onClick={onNext}
            disabled={index >= order.length - 1}
            className="p-1.5 rounded-full text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors disabled:opacity-40 disabled:hover:text-app-text-muted disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </Tooltip>
        <span className="h-4 w-[1px] bg-app-border mx-0.5" aria-hidden />
        <Tooltip label={t('canvas.presentation.order')}>
          <button
            type="button"
            aria-pressed={draft !== null}
            onClick={() => setDraft((d) => (d === null ? [...order] : null))}
            className={`p-1.5 rounded-full transition-colors ${
              draft !== null
                ? 'text-app-accent bg-app-surface-subtle'
                : 'text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={t('canvas.presentation.exit')}>
          <button
            type="button"
            onClick={onExit}
            className="p-1.5 rounded-full text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {/* 半透明说明：点画布空白同样翻到下一张（由 App 在演示态把空白单击接到 next） */}
      <div className="mt-1.5 font-sans text-[11px] text-app-text-faint/70 pointer-events-none select-none">
        {t('canvas.presentation.blank_click_hint')}
      </div>
    </div>
  );
}
