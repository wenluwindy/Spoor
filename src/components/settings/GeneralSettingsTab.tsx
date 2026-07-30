import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Monitor } from 'lucide-react';
import type { AIConfigV2 } from '../../types/aiConfig';
import { setMetasoApiKey } from '../../services/aiConfigEdit';
import { DESKTOP_RELEASE_URL } from '../../constants/desktopRelease';
import { openExternalUrl } from '../../utils/openExternal';
import { isTauriRuntime } from '../../utils/isTauriRuntime';
import { AISettingsDocsPanel } from '../AISettingsDocsPanel';

export interface GeneralSettingsTabProps {
  config: AIConfigV2;
  onChange: (next: AIConfigV2) => void;
  /** 文档面板按当前对话服务商给对应的链接。 */
  activeProviderKind: string;
}

export function GeneralSettingsTab({
  config,
  onChange,
  activeProviderKind,
}: GeneralSettingsTabProps) {
  const { t, i18n } = useTranslation();
  const inDesktopApp = isTauriRuntime();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
          {t('settings.language')}
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(['en', 'zh'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                i18n.changeLanguage(lang);
                localStorage.setItem('app_language', lang);
              }}
              className={`flex items-center justify-center gap-2 h-10 px-4 rounded-lg border transition-all text-sm font-bold ${
                i18n.language === lang
                  ? 'border-[#C2410C] bg-[#C2410C]/5 text-[#C2410C]'
                  : 'border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/30'
              }`}
            >
              {lang === 'en' ? 'English' : '中文'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-[#F4F1ED]" />

      <div className="p-4 rounded-xl border border-[#E6E4DF] bg-[#FAF9F6] space-y-3">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#C2410C]/10 border border-[#C2410C]/20 flex items-center justify-center text-[#C2410C] flex-shrink-0">
            <Monitor className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#1a1a1a]">
              {inDesktopApp
                ? t('settings.desktop_installed_title')
                : t('settings.desktop_download_title')}
            </p>
            <p className="text-[11px] text-[#5a5a54] leading-relaxed mt-1">
              {inDesktopApp
                ? t('settings.desktop_installed_blurb')
                : t('settings.desktop_download_blurb')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openExternalUrl(DESKTOP_RELEASE_URL)}
          className="w-full flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-[#C2410C]/40 bg-[#C2410C]/5 text-[#C2410C] text-sm font-bold hover:bg-[#C2410C]/10 transition-colors"
        >
          <Download className="w-4 h-4" />
          {inDesktopApp
            ? t('settings.desktop_releases_button')
            : t('settings.desktop_download_button')}
        </button>
      </div>

      <div className="h-px bg-[#F4F1ED]" />

      {/* 联网搜索是全局能力，不属于任何服务商，所以放在通用页 */}
      <div className="space-y-2">
        <label
          className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider"
          htmlFor="metaso-key"
        >
          {t('settings.metaso_key')}
        </label>
        <input
          id="metaso-key"
          type="password"
          className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
          placeholder="sk-metaso-..."
          value={config.metasoApiKey ?? ''}
          onChange={(e) => onChange(setMetasoApiKey(config, e.target.value))}
        />
        <p className="text-[10px] text-[#8c8a84] leading-relaxed">{t('settings.metaso_key_hint')}</p>
      </div>

      <AISettingsDocsPanel provider={activeProviderKind} />
    </div>
  );
}
