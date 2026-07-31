import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Loader2, Save, Trash2 } from 'lucide-react';
import {
  mediaDelete,
  mediaExport,
  mediaList,
  mediaReveal,
  type MediaEntry,
} from '../../services/mediaStore';
import { db } from '../../db';
import { mediaUrl } from '../../utils/mediaUrl';
import { useAppDialog } from '../AppDialogProvider';
import { Tooltip } from '../ui/Tooltip';
import { formatBytes } from './formatBytes';

export type AssetFilter = 'all' | 'generated' | 'uploaded' | 'unreferenced';

const FILTERS: AssetFilter[] = ['all', 'generated', 'uploaded', 'unreferenced'];

/**
 * 收集画布上还在被引用的相对路径。
 *
 * 三个来源：媒体节点的 `filePath`、生图节点的**全部历史**结果。
 * 「全部历史」而不是只算当前显示的那张——历史是可以翻回去的，
 * 把没显示的那些算成未引用会导致用户一键删掉自己还想要的图。
 */
export async function collectReferencedPaths(): Promise<Set<string>> {
  const nodes = await db.nodes.toArray();
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (node.filePath) referenced.add(node.filePath);
    for (const rel of node.imageGenResults ?? []) referenced.add(rel);
  }
  return referenced;
}

export function MediaAssetManager() {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const [entries, setEntries] = useState<MediaEntry[] | null>(null);
  const [referenced, setReferenced] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [list, refs] = await Promise.all([mediaList(), collectReferencedPaths()]);
    setEntries(list);
    setReferenced(refs);
    setSelected(new Set());
  };

  useEffect(() => {
    void reload().catch(() => setEntries([]));
    // 只在挂载时拉一次；删除后由操作自己刷新
  }, []);

  const visible = useMemo(() => {
    const list = entries ?? [];
    if (filter === 'all') return list;
    if (filter === 'unreferenced') return list.filter((e) => !referenced.has(e.rel));
    return list.filter((e) => e.rel.startsWith(`media/${filter}/`));
  }, [entries, filter, referenced]);

  const toggle = (rel: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  const handleDelete = async () => {
    if (selected.size === 0 || busy) return;
    const stillUsed = [...selected].filter((rel) => referenced.has(rel)).length;
    setBusy(true);
    try {
      const ok = await confirm({
        title: t('settings.assets_delete'),
        message: stillUsed > 0
          ? t('settings.assets_delete_confirm_in_use', { count: selected.size, used: stillUsed })
          : t('settings.assets_delete_confirm', { count: selected.size }),
        confirmLabel: t('settings.assets_delete_ok'),
        variant: 'danger',
      });
      if (!ok) return;
      await mediaDelete([...selected]);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    const [rel] = [...selected];
    if (!rel) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({ defaultPath: rel.split('/').pop() });
    if (dest) await mediaExport(rel, dest);
  };

  if (entries === null) {
    return (
      <p className="text-[11px] text-app-text-faint flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t('settings.storage_loading')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`px-2.5 h-7 rounded-lg text-[11px] font-bold border transition-colors ${
              filter === id
                ? 'border-app-accent bg-app-accent/5 text-app-accent'
                : 'border-app-border text-app-text-muted hover:border-app-accent/40'
            }`}
          >
            {t(`settings.assets_filter_${id}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-[11px] text-app-text-faint">{t('settings.assets_empty')}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 max-h-[240px] overflow-y-auto">
          {visible.map((entry) => {
            const isSelected = selected.has(entry.rel);
            const unused = !referenced.has(entry.rel);
            return (
              <li key={entry.rel}>
                <button
                  type="button"
                  onClick={() => toggle(entry.rel)}
                  aria-pressed={isSelected}
                  aria-label={entry.rel}
                  className={`w-full text-left rounded-lg border overflow-hidden transition-colors ${
                    isSelected ? 'border-app-accent ring-1 ring-app-accent' : 'border-app-border'
                  }`}
                >
                  <span className="block h-16 bg-app-surface-subtle">
                    <img
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      src={mediaUrl(entry.rel)}
                    />
                  </span>
                  <span className="block px-1.5 py-1 text-[10px] text-app-text-muted font-mono truncate">
                    {formatBytes(entry.bytes)}
                    {unused && <span className="text-app-accent"> · {t('settings.assets_unused')}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-app-text-faint">
          {t('settings.assets_selected', { count: selected.size })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t('settings.assets_export')}>
            <button
              type="button"
              disabled={selected.size !== 1}
              onClick={() => void handleExport()}
              className="p-1.5 text-app-text-muted hover:text-app-accent disabled:opacity-30 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t('settings.assets_reveal')}>
            <button
              type="button"
              disabled={selected.size !== 1}
              onClick={() => void mediaReveal([...selected][0])}
              className="p-1.5 text-app-text-muted hover:text-app-accent disabled:opacity-30 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t('settings.assets_delete')}>
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={() => void handleDelete()}
              className="p-1.5 text-app-text-muted hover:text-app-accent disabled:opacity-30 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
