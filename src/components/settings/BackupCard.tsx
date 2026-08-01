import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Download, Loader2, RotateCcw, Upload } from 'lucide-react';
import { useAppDialog } from '../AppDialogProvider';
import {
  backupFileName,
  buildBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type SpoorBackup,
} from '../../services/backup';
import { listSnapshots, readSnapshot, type SnapshotEntry } from '../../services/autoBackup';
import { getAppVersion } from '../../utils/appVersion';
import { openTextFile, saveTextFile } from '../../utils/userTextFile';
import { formatBytes } from './formatBytes';

/**
 * 备份与恢复。
 *
 * 还原是**破坏性的整体替换**，所以走两道关：先弹危险确认并把备份里的规模念出来
 * （几张画布、几个节点、什么时候建的），确认之后再动库。还原完主动重载窗口——
 * 主题、语言这些偏好住在 localStorage 里，各自的 store 只在启动时读一次，
 * 不重载的话画面会停在旧设置上，看起来像是"还原了一半"。
 */
export function BackupCard() {
  const { t } = useTranslation();
  const { alert: appAlert, confirm } = useAppDialog();
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listSnapshots().then(setSnapshots);
  }, []);

  const exportAll = useCallback(async () => {
    setBusy(true);
    try {
      const now = Date.now();
      const backup = await buildBackup(await getAppVersion(), now);
      await saveTextFile(backupFileName(new Date(now)), serializeBackup(backup), [
        { name: 'JSON', extensions: ['json'] },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  const applyRestore = useCallback(
    async (backup: SpoorBackup) => {
      const ok = await confirm({
        title: t('settings.backup_restore'),
        message: t('settings.backup_restore_confirm', {
          date: new Date(backup.createdAt).toLocaleString(),
          canvases: backup.tables.canvases.length,
          nodes: backup.tables.nodes.length,
        }),
        confirmLabel: t('settings.backup_restore_ok'),
        variant: 'danger',
      });
      if (!ok) return;

      setBusy(true);
      try {
        const summary = await restoreBackup(backup);
        await appAlert({
          message: t('settings.backup_restore_done', {
            canvases: summary.canvases,
            nodes: summary.nodes,
          }),
        });
        window.location.reload();
      } finally {
        setBusy(false);
      }
    },
    [appAlert, confirm, t],
  );

  const restoreFromFile = useCallback(async () => {
    const picked = await openTextFile([{ name: 'JSON', extensions: ['json'] }], '.json');
    if (!picked) return;
    const backup = parseBackup(picked.text);
    if (!backup) {
      await appAlert({ message: t('settings.backup_invalid') });
      return;
    }
    await applyRestore(backup);
  }, [appAlert, applyRestore, t]);

  const restoreFromSnapshot = useCallback(
    async (name: string) => {
      const backup = await readSnapshot(name);
      if (!backup) {
        await appAlert({ message: t('settings.backup_invalid') });
        return;
      }
      await applyRestore(backup);
    },
    [appAlert, applyRestore, t],
  );

  return (
    <div className="p-4 rounded-xl border border-app-border bg-app-surface space-y-3">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent shrink-0">
          <Archive className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
            {t('settings.backup_title')}
          </p>
          <p className="text-[11px] text-app-text-muted mt-1 leading-relaxed">
            {t('settings.backup_blurb')}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportAll()}
          className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-app-accent/40 bg-app-accent/5 text-app-accent text-sm font-bold hover:bg-app-accent/10 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {t('settings.backup_export')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void restoreFromFile()}
          className="flex-1 flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-app-border text-app-text-muted text-sm font-bold hover:text-app-text hover:border-app-accent/40 transition-colors disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {t('settings.backup_restore')}
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
          {t('settings.backup_snapshots')}
        </p>
        {snapshots.length === 0 ? (
          <p className="text-[11px] text-app-text-faint leading-relaxed">
            {t('settings.backup_snapshots_empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {snapshots.map((snapshot) => (
              <li
                key={snapshot.name}
                className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg bg-app-surface-raised border border-app-border"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-app-text truncate">{snapshot.name}</p>
                  <p className="text-[10px] text-app-text-faint">
                    {new Date(snapshot.mtime).toLocaleString()} · {formatBytes(snapshot.bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restoreFromSnapshot(snapshot.name)}
                  className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-app-border text-[11px] font-bold text-app-text-muted hover:text-app-accent hover:border-app-accent/40 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('settings.backup_snapshot_restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
