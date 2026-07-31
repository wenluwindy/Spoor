import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Globe } from 'lucide-react';
import type { AIConfigV2 } from '../../types/aiConfig';
import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from '../../constants/searchProviders';
import { setSearchApiKey, setSearchProvider } from '../../services/aiConfigEdit';
import { openExternalUrl } from '../../utils/openExternal';

const FIELD =
  'w-full h-10 px-3 bg-app-surface border border-app-border rounded-lg text-sm outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-all';
const META_LABEL =
  'text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider';

export interface SearchSettingsTabProps {
  config: AIConfigV2;
  onChange: (next: AIConfigV2) => void;
}

/**
 * 搜索服务页。
 *
 * 联网搜索是全局能力，不挂在任何模型服务商下，原来挤在通用页底部。
 * 各家 Key 各存各的，上方单选决定当前用哪家——切换服务不该把已填的 Key 冲掉。
 */
export function SearchSettingsTab({ config, onChange }: SearchSettingsTabProps) {
  const { t } = useTranslation();
  const active = config.searchProvider ?? DEFAULT_SEARCH_PROVIDER;

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent shrink-0">
          <Globe className="w-4 h-4" />
        </div>
        <p className="text-[11px] text-app-text-muted leading-relaxed">
          {t('settings.search_intro')}
        </p>
      </div>

      <div className="space-y-3">
        <span className={META_LABEL}>{t('settings.search_active')}</span>
        <div className="grid grid-cols-2 gap-3">
          {SEARCH_PROVIDERS.map((provider) => (
            <button
              key={provider.kind}
              type="button"
              aria-pressed={active === provider.kind}
              onClick={() => onChange(setSearchProvider(config, provider.kind))}
              className={`flex items-center justify-center h-10 px-4 rounded-lg border transition-all text-sm font-bold ${
                active === provider.kind
                  ? 'border-app-accent bg-app-accent/5 text-app-accent'
                  : 'border-app-border text-app-text-muted hover:border-app-accent/30'
              }`}
            >
              {provider.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-app-text-faint leading-relaxed">
          {t('settings.search_active_hint')}
        </p>
      </div>

      <div className="h-px bg-app-surface-subtle" />

      {SEARCH_PROVIDERS.map((provider) => (
        <div key={provider.kind} className="space-y-2">
          <label className={META_LABEL} htmlFor={`search-key-${provider.kind}`}>
            {t('settings.search_key_label', { name: provider.label })}
          </label>
          <input
            id={`search-key-${provider.kind}`}
            type="password"
            className={FIELD}
            placeholder={provider.keyPlaceholder}
            value={config.searchApiKeys?.[provider.kind] ?? ''}
            onChange={(e) => onChange(setSearchApiKey(config, provider.kind, e.target.value))}
          />
          <p className="text-[10px] text-app-text-faint leading-relaxed">
            {t(`settings.search_hint_${provider.kind}`)}
          </p>
          <a
            href={provider.consoleUrl}
            role="link"
            className="inline-flex items-center gap-1 text-[11px] text-[#1d4ed8] hover:underline cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              void openExternalUrl(provider.consoleUrl);
            }}
          >
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
            {t('settings.search_get_key', { name: provider.label })}
          </a>
        </div>
      ))}
    </div>
  );
}
