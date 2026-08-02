import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { usePendingOrganizePlan } from '../../services/organizePreview';

/**
 * AI 整理的预览层，两个组件对应两个坐标系：
 * - `OrganizePreviewGhosts` 渲染在画布内容容器里（跟着 transform 走）——每个拟建
 *   区域框一个虚线矩形 + 标题，命中卡片的目标位置画一个淡色占位框；
 * - `OrganizePreviewBar` 渲染在 App 层（屏幕坐标）——确认/取消。
 *   分开是因为内容容器带 transform，fixed 定位在它里面会失效。
 */

export function OrganizePreviewGhosts() {
  const plan = usePendingOrganizePlan();
  if (!plan) return null;
  return (
    <>
      {plan.frames.map((frame) => (
        <div
          key={frame.id}
          data-export-hide=""
          className="pointer-events-none absolute z-40 rounded-xl border-2 border-dashed border-app-accent/60 bg-app-accent/5"
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        >
          <div className="px-4 pt-3 font-sans text-sm font-bold text-app-accent/80">
            {frame.content}
          </div>
        </div>
      ))}
      {plan.moves.map((move) => (
        <div
          key={move.id}
          data-export-hide=""
          className="pointer-events-none absolute z-40 rounded-lg border border-app-accent/40"
          style={{ left: move.after.x, top: move.after.y, width: 60, height: 36 }}
        />
      ))}
    </>
  );
}

export function OrganizePreviewBar(props: { onApply: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const plan = usePendingOrganizePlan();
  if (!plan) return null;
  return (
    <div
      data-export-hide=""
      className="absolute top-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-app-border bg-app-surface-raised/95 px-4 py-2 shadow-lg backdrop-blur-sm"
    >
      <span className="font-sans text-xs text-app-text-soft">
        {t('canvas.organize_preview', { groups: plan.groups.length, moved: plan.moves.length })}
      </span>
      <button
        type="button"
        onClick={props.onApply}
        className="flex items-center gap-1 rounded-full bg-app-inverse px-3 py-1 font-sans text-xs font-bold text-app-on-inverse hover:bg-app-inverse-hover transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
        {t('canvas.organize_apply')}
      </button>
      <button
        type="button"
        onClick={props.onCancel}
        className="flex items-center gap-1 rounded-full border border-app-border px-3 py-1 font-sans text-xs text-app-text-muted hover:border-app-accent hover:text-app-accent transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        {t('canvas.organize_cancel')}
      </button>
    </div>
  );
}
