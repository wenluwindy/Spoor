import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDownToLine, CheckCircle2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { checkForUpdate, downloadUpdate, installUpdate } from '../../services/appUpdate';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { openExternalUrl } from '../../utils/openExternal';
import { formatBytes } from './formatBytes';

const BUTTON =
  'w-full flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-app-accent/40 bg-app-accent/5 text-app-accent text-sm font-bold hover:bg-app-accent/10 transition-colors disabled:opacity-50';

/**
 * 检查更新。
 *
 * 顶掉了原来那张「打开 Releases 页面」卡片——那个只是把浏览器丢到 GitHub，
 * 剩下的下载、找文件、装回来全甩给用户。
 *
 * 状态机在 [`services/appUpdate`] 里，这里只负责按 phase 渲染。
 */
export function UpdateCard() {
  const { t } = useTranslation();
  const { phase, info, progress, error } = useAppUpdate();

  const busy = phase === 'checking' || phase === 'downloading';

  return (
    <div className="p-4 rounded-xl border border-app-border bg-app-surface space-y-3">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent flex-shrink-0">
          {phase === 'available' || phase === 'ready' ? (
            <Sparkles className="w-4 h-4" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-app-text">{t('settings.update_title')}</p>
          <p className="text-[11px] text-app-text-muted leading-relaxed mt-1">
            {info?.currentVersion
              ? t('settings.update_current_version', { version: info.currentVersion })
              : t('settings.update_blurb')}
          </p>
        </div>
      </div>

      {phase === 'up_to_date' && (
        <p className="flex items-center gap-1.5 text-[11px] text-[#3f7d4f]">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {t('settings.update_up_to_date')}
        </p>
      )}

      {(phase === 'available' || phase === 'downloading' || phase === 'ready') && info && (
        <div className="rounded-lg border border-app-accent/30 bg-app-accent/5 p-3 space-y-2">
          <p className="text-[11px] font-bold text-app-accent">
            {t('settings.update_available', { version: info.latestVersion })}
          </p>
          {info.assetSize > 0 && (
            <p className="text-[10px] font-mono text-app-text-faint">
              {info.assetName} · {formatBytes(info.assetSize)}
            </p>
          )}
          {info.notes.trim() && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[10px] font-mono uppercase tracking-wider text-app-text-faint [&::-webkit-details-marker]:hidden">
                {t('settings.update_notes')}
              </summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-app-text-muted leading-relaxed font-sans">
                {info.notes}
              </pre>
            </details>
          )}
          {info.releaseUrl && (
            <a
              href={info.releaseUrl}
              role="link"
              className="inline-block text-[11px] text-[#1d4ed8] hover:underline cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                void openExternalUrl(info.releaseUrl);
              }}
            >
              {t('settings.update_open_release')}
            </a>
          )}
        </div>
      )}

      {phase === 'downloading' && (
        <div className="space-y-1.5">
          {/* 安装包几十 MB，没有进度条用户会以为卡死 */}
          <div className="h-1.5 rounded-full bg-app-surface-sunken overflow-hidden">
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('settings.update_downloading')}
              className="h-full bg-app-accent transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-app-text-faint">
            {t('settings.update_downloading')} {progress}%
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[11px] text-app-accent">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('settings.update_failed')}
          </p>
          {error && (
            <p className="text-[10px] font-mono text-app-text-faint break-all line-clamp-3">{error}</p>
          )}
        </div>
      )}

      {phase === 'ready' ? (
        <>
          <button type="button" onClick={() => void installUpdate()} className={BUTTON}>
            <ArrowDownToLine className="w-4 h-4" />
            {t('settings.update_install')}
          </button>
          {/* 安装程序会先关掉本应用，提前说一声比装到一半才发现强 */}
          <p className="text-[10px] text-app-text-faint leading-relaxed">
            {t('settings.update_install_hint')}
          </p>
        </>
      ) : phase === 'available' || phase === 'downloading' ? (
        <button
          type="button"
          onClick={() => void downloadUpdate()}
          disabled={phase === 'downloading'}
          className={BUTTON}
        >
          {phase === 'downloading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowDownToLine className="w-4 h-4" />
          )}
          {t('settings.update_download')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void checkForUpdate()}
          disabled={busy}
          className={BUTTON}
        >
          {phase === 'checking' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {phase === 'checking' ? t('settings.update_checking') : t('settings.update_check')}
        </button>
      )}
    </div>
  );
}
