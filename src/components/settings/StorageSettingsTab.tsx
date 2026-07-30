import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderOpen, HardDrive, Loader2 } from 'lucide-react';
import { mediaOpenRoot, mediaStoreInfo, type MediaStoreInfo } from '../../services/mediaStore';
import { isTauriRuntime } from '../../utils/isTauriRuntime';
import { formatBytes } from './formatBytes';
import { MediaAssetManager } from './MediaAssetManager';

/** 存储页：数据目录概览 + 资产管理器。 */
export function StorageSettingsTab() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<MediaStoreInfo | null>(null);
  const [error, setError] = useState(false);
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

  if (!inDesktopApp) {
    return (
      <p className="text-[11px] text-[#8c8a84] leading-relaxed">{t('settings.storage_desktop_only')}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-[#E6E4DF] bg-[#FAF9F6] space-y-3">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#C2410C]/10 border border-[#C2410C]/20 flex items-center justify-center text-[#C2410C] shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
              {t('settings.storage_root')}
            </p>
            {error ? (
              <p className="text-[11px] text-[#C2410C] mt-1">{t('settings.storage_read_failed')}</p>
            ) : info ? (
              <>
                <p className="text-[11px] font-mono text-[#1a1a1a] mt-1 break-all">{info.root}</p>
                <p className="text-[11px] text-[#5a5a54] mt-1">
                  {t('settings.storage_usage', {
                    size: formatBytes(info.bytes),
                    count: info.count,
                  })}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-[#8c8a84] mt-1 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('settings.storage_loading')}
              </p>
            )}
          </div>
        </div>

        {info?.fallback && (
          <div className="flex gap-2 text-[11px] text-[#5a5a54] leading-relaxed bg-white border border-[#E6E4DF] rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#C2410C] shrink-0 mt-0.5" />
            {/* 安装目录写不进去（多半是装到了 Program Files），已回退 */}
            <span>{t('settings.storage_fallback_hint')}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void mediaOpenRoot()}
          className="w-full flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-[#C2410C]/40 bg-[#C2410C]/5 text-[#C2410C] text-sm font-bold hover:bg-[#C2410C]/10 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          {t('settings.storage_open_folder')}
        </button>
      </div>

      <MediaAssetManager />

      <p className="text-[10px] text-[#8c8a84] leading-relaxed">{t('settings.storage_blurb')}</p>
    </div>
  );
}
