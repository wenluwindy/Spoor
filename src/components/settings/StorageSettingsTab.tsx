import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderInput, FolderOpen, HardDrive, Loader2 } from 'lucide-react';
import { mediaOpenRoot, mediaStoreInfo, type MediaStoreInfo } from '../../services/mediaStore';
import { dataRootMigrate, type DataRootMigrateProgress } from '../../services/dataRoot';
import { pickDirectory } from '../../utils/userTextFile';
import { isTauriRuntime } from '../../utils/isTauriRuntime';
import { useAppDialog } from '../AppDialogProvider';
import { formatBytes } from './formatBytes';
import { BackupCard } from './BackupCard';
import { MediaAssetManager } from './MediaAssetManager';

/** 存储页：数据目录概览（含迁移）+ 备份 + 资产管理器。 */
export function StorageSettingsTab() {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [info, setInfo] = useState<MediaStoreInfo | null>(null);
  const [error, setError] = useState(false);
  /** 非 null 表示迁移进行中；数值随 `data-root-migrate-progress` 事件更新。 */
  const [migrating, setMigrating] = useState<DataRootMigrateProgress | null>(null);
  /** 迁移成功后旧目录的位置，常驻提示「确认无误后可手动删除」。 */
  const [oldRoot, setOldRoot] = useState<string | null>(null);
  const inDesktopApp = isTauriRuntime();

  useEffect(() => {
    if (!inDesktopApp) return;
    let cancelled = false;
    void mediaStoreInfo()
      .then((next) => !cancelled && setInfo(next))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [inDesktopApp]);

  const changeLocation = useCallback(async () => {
    // 目录对话框在 Rust 侧弹，选中的路径当场进写入白名单——data_root_migrate 只认这种
    const parent = await pickDirectory();
    if (!parent) return;

    const previousRoot = info?.root ?? '';
    setMigrating({ copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0 });
    try {
      await dataRootMigrate(parent, setMigrating);
      setOldRoot(previousRoot);
      setInfo(await mediaStoreInfo());
      // 先收进度条再弹结果对话框，别让「迁移中」的样子压在成功提示底下
      setMigrating(null);
      await appAlert({ message: t('settings.storage_migrate_done', { path: previousRoot }) });
    } catch (e) {
      setMigrating(null);
      const raw = String(e instanceof Error ? e.message : e);
      // target_exists 单独认码：这是「换个位置」而不是「出错重试」
      const message = raw.includes('target_exists')
        ? t('settings.storage_migrate_target_exists')
        : t('settings.storage_migrate_failed', { error: raw });
      await appAlert({ message });
    }
  }, [appAlert, info, t]);

  if (!inDesktopApp) {
    return (
      <p className="text-[11px] text-app-text-faint leading-relaxed">{t('settings.storage_desktop_only')}</p>
    );
  }

  const migratePercent = migrating
    ? migrating.bytesTotal > 0
      ? Math.min(100, Math.round((migrating.bytesCopied / migrating.bytesTotal) * 100))
      : 0
    : 0;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-app-border bg-app-surface space-y-3">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
              {t('settings.storage_root')}
            </p>
            {error ? (
              <p className="text-[11px] text-app-accent mt-1">{t('settings.storage_read_failed')}</p>
            ) : info ? (
              <>
                <p className="text-[11px] font-mono text-app-text mt-1 break-all">{info.root}</p>
                <p className="text-[11px] text-app-text-muted mt-1">
                  {t('settings.storage_usage', {
                    size: formatBytes(info.bytes),
                    count: info.count,
                  })}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-app-text-faint mt-1 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('settings.storage_loading')}
              </p>
            )}
          </div>
        </div>

        {info?.fallback && (
          <div className="flex gap-2 text-[11px] text-app-text-muted leading-relaxed bg-app-surface-raised border border-app-border rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-app-accent shrink-0 mt-0.5" />
            {/* 安装目录写不进去（多半是装到了 Program Files），已回退 */}
            <span>{t('settings.storage_fallback_hint')}</span>
          </div>
        )}

        {/* 0.5.0 笔记落文件：告诉用户笔记本体现在也在这个目录里（notes/），
            连同网盘同步的提示——这是"把 SpoorData 放进同步文件夹"方案的完整版 */}
        <div className="flex gap-2 text-[11px] text-app-text-muted leading-relaxed bg-app-surface-raised border border-app-border rounded-lg p-2.5">
          <span>{t('settings.storage_notes_mirror_hint')}</span>
        </div>

        {migrating && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-app-text-muted flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('settings.storage_migrating', {
                copied: migrating.copied,
                total: migrating.total,
              })}
            </p>
            <div className="h-1.5 rounded-full bg-app-surface-raised border border-app-border overflow-hidden">
              <div
                className="h-full bg-app-accent transition-[width] duration-200"
                style={{ width: `${migratePercent}%` }}
              />
            </div>
          </div>
        )}

        {oldRoot && !migrating && (
          <p className="text-[11px] text-app-text-muted leading-relaxed bg-app-surface-raised border border-app-border rounded-lg p-2.5">
            {t('settings.storage_migrate_old_kept', { path: oldRoot })}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!!migrating}
            onClick={() => void mediaOpenRoot()}
            className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-app-accent/40 bg-app-accent/5 text-app-accent text-sm font-bold hover:bg-app-accent/10 transition-colors disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            {t('settings.storage_open_folder')}
          </button>
          <button
            type="button"
            disabled={!!migrating || !info}
            onClick={() => void changeLocation()}
            className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-app-border text-app-text-muted text-sm font-bold hover:text-app-text hover:border-app-accent/40 transition-colors disabled:opacity-50"
          >
            {migrating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderInput className="w-4 h-4" />
            )}
            {t('settings.storage_change_location')}
          </button>
        </div>
      </div>

      <BackupCard />

      <MediaAssetManager />

      <p className="text-[10px] text-app-text-faint leading-relaxed">{t('settings.storage_blurb')}</p>
    </div>
  );
}
