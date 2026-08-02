import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterX, Merge, Pencil, Tag, Trash2 } from 'lucide-react';
import type { CanvasNode } from '../../db';
import { clearTags, toggleTag, useTagFilter } from '../../services/tagFilter';
import { deleteTag, renameTag } from '../../services/tagOps';
import { useAppDialog } from '../AppDialogProvider';
import { ContextMenuSurface } from './ContextMenuSurface';

/**
 * 画布顶部的标签筛选栏（B6）。
 *
 * 从当前画布的节点里聚合出去重后的标签列表（带计数）；没有任何标签时整条不渲染——
 * 不用标签的人不该看到一条空壳。点 chip 点亮/熄灭筛选（多标签并集，语义见
 * `services/tagFilter`），右键 chip 弹管理菜单：重命名 / 合并到… / 删除，
 * 批量写库走 `services/tagOps` 的可撤销通道。
 *
 * 「淡出非命中卡片」不在这里做——那是每张卡自己的渲染（CanvasNodeItem 读
 * `useTagFilter()` + `nodeMatchesTagFilter`），这里只负责开关。
 */

export interface TagFilterBarProps {
  canvasId: string;
  /** 当前画布的节点（App 已按 canvasId 过滤好的 dynamicNodes）。 */
  nodes: CanvasNode[];
}

export interface TagCount {
  label: string;
  count: number;
}

/** 聚合去重标签并计数，按「用得多的在前，同频按字典序」排，顺序稳定不跳。 */
export function collectTagCounts(nodes: Pick<CanvasNode, 'tags'>[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function TagFilterBar({ canvasId, nodes }: TagFilterBarProps) {
  const { t } = useTranslation();
  const { prompt } = useAppDialog();
  const activeTags = useTagFilter();
  const tags = useMemo(() => collectTagCounts(nodes), [nodes]);
  const [menu, setMenu] = useState<{ tag: string; x: number; y: number } | null>(null);

  if (tags.length === 0) return null;

  const handleRename = async (tag: string) => {
    const input = await prompt({
      title: t('canvas.tags.rename_title', { tag }),
      placeholder: t('canvas.tags.rename_placeholder'),
      defaultValue: tag,
    });
    if (input === null) return;
    // 逗号是打标签时的分隔符，出现在标签名里会让它再也输不回去，换成空格
    const next = input.replace(/[,，]/g, ' ').trim();
    if (next === '' || next === tag) return;
    await renameTag(canvasId, tag, next);
  };

  return (
    <>
      <div
        data-tag-filter-bar=""
        className="absolute top-6 left-1/2 -translate-x-1/2 z-30 max-w-[min(42rem,calc(100%-3rem))]"
      >
        <div className="bg-app-surface-raised/95 backdrop-blur-sm border border-app-border rounded-full shadow-md pl-3 pr-2 py-1.5 flex items-center gap-1.5 flex-wrap justify-center">
          <Tag className="w-3.5 h-3.5 text-app-text-faint shrink-0" aria-hidden />
          {tags.map(({ label, count }) => {
            const active = activeTags.has(label);
            return (
              <button
                key={label}
                type="button"
                data-tag-chip={label}
                aria-pressed={active}
                onClick={() => toggleTag(label)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ tag: label, x: e.clientX, y: e.clientY });
                }}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-sans text-xs transition-colors ${
                  active
                    ? 'border-app-accent bg-app-accent text-white shadow-sm'
                    : 'border-app-border bg-app-surface text-app-text-muted hover:border-app-accent hover:text-app-accent'
                }`}
              >
                <span className="max-w-[10rem] truncate">{label}</span>
                <span
                  className={`tabular-nums text-[10px] ${active ? 'text-white/80' : 'text-app-text-faint'}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <button
              type="button"
              data-tag-clear-filter=""
              onClick={clearTags}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 font-sans text-xs text-app-text-muted hover:text-app-accent hover:bg-app-surface-subtle transition-colors"
            >
              <FilterX className="w-3.5 h-3.5" />
              {t('canvas.tags.clear_filter')}
            </button>
          )}
        </div>
      </div>

      {menu && (
        <ContextMenuSurface
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'tag-ops',
              entries: [
                {
                  id: 'rename',
                  label: t('canvas.tags.rename'),
                  icon: Pencil,
                  onSelect: () => void handleRename(menu.tag),
                },
                {
                  id: 'merge',
                  label: t('canvas.tags.merge_into'),
                  icon: Merge,
                  disabled: tags.length < 2,
                  submenu: tags
                    .filter(({ label }) => label !== menu.tag)
                    .map(({ label }) => ({
                      id: `merge:${label}`,
                      label,
                      onSelect: () => void renameTag(canvasId, menu.tag, label),
                    })),
                },
                {
                  id: 'delete',
                  label: t('canvas.tags.delete'),
                  icon: Trash2,
                  danger: true,
                  onSelect: () => void deleteTag(canvasId, menu.tag),
                },
              ],
            },
          ]}
        />
      )}
    </>
  );
}
