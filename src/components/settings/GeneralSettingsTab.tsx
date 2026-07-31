import React from 'react';
import { useTranslation } from 'react-i18next';
import { APP_THEMES } from '../../constants/appThemes';
import { setAppThemeId } from '../../services/appTheme';
import { useAppTheme } from '../../hooks/useAppTheme';
import { UpdateCard } from './UpdateCard';

/**
 * 通用页：语言 · 主题 · 检查更新。
 *
 * 秘塔 Key 搬去了「搜索服务」页，配置说明与官方文档搬去了「帮助」页——
 * 这里原本什么都往下堆，找一个设置得先滚过三屏。
 */
export function GeneralSettingsTab() {
  const { t, i18n } = useTranslation();
  const { id: activeThemeId } = useAppTheme();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
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
                  ? 'border-app-accent bg-app-accent/5 text-app-accent'
                  : 'border-app-border text-app-text-muted hover:border-app-accent/30'
              }`}
            >
              {lang === 'en' ? 'English' : '中文'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-app-surface-subtle" />

      {/* 主题是全局的：配色 + 便签/主题卡外壳一并切换（见 constants/appThemes） */}
      <div className="space-y-3">
        <label className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
          {t('settings.theme')}
        </label>
        <div className="grid grid-cols-2 gap-3">
          {APP_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={activeThemeId === theme.id}
              onClick={() => setAppThemeId(theme.id)}
              className={`flex items-center gap-3 h-11 px-3 rounded-lg border transition-all text-sm font-bold ${
                activeThemeId === theme.id
                  ? 'border-app-accent bg-app-accent/5 text-app-accent'
                  : 'border-app-border text-app-text-muted hover:border-app-accent/30'
              }`}
            >
              <span
                className="w-6 h-6 shrink-0 rounded-full border border-black/10 shadow-sm relative overflow-hidden"
                style={{ backgroundColor: theme.swatch.surface }}
                aria-hidden
              >
                <span
                  className="absolute inset-y-0 right-0 w-1/2"
                  style={{ backgroundColor: theme.swatch.accent }}
                />
              </span>
              {t(theme.labelKey)}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-app-text-faint leading-relaxed">{t('settings.theme_hint')}</p>
      </div>

      <div className="h-px bg-app-surface-subtle" />

      <UpdateCard />
    </div>
  );
}
