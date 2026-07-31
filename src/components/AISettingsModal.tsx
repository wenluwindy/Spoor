import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, X } from 'lucide-react';
import type { AIConfigV2 } from '../types/aiConfig';
import { resolveActiveChatTarget } from '../services/aiConfig';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import { ProvidersSettingsTab } from './settings/ProvidersSettingsTab';
import { SearchSettingsTab } from './settings/SearchSettingsTab';
import { StorageSettingsTab } from './settings/StorageSettingsTab';
import { HelpSettingsTab } from './settings/HelpSettingsTab';
import type { SearchProviderKind } from '../types/aiConfig';

/**
 * v1 的扁平配置形状。
 *
 * 配置本身已经是 v2（多服务商），但对话链路仍吃这一份扁平结构，由
 * `services/aiConfig.resolveActiveChatConfig` 压出来。类型留在这里是因为
 * `services/ai`、`ResearchLab`、`AgentsStudio` 都从这里 import，挪走等于
 * 把重构的爆炸半径又扩大一圈。
 */
export interface AIConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Tauri 本地 GGUF 绝对路径；provider 为 local_llama 时使用 */
  localGgufPath?: string;
  /** 可选：Thinking 变体需套用带思考块的模板时设为 true */
  localEnableThinking?: boolean;
  /**
   * @deprecated v1 时代的秘塔 Key。只在 `migrateV1ToV2` 读老配置时还会出现，
   * 新代码一律用下面的 `searchApiKey`。
   */
  metasoApiKey?: string;
  /** 当前启用的联网搜索服务与它的 Key，由 `resolveSearchConfig` 压进来。 */
  searchProvider?: SearchProviderKind;
  searchApiKey?: string;
}

type SettingsTab = 'general' | 'providers' | 'search' | 'storage' | 'help';

const TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.tab_general' },
  { id: 'providers', labelKey: 'settings.tab_providers' },
  { id: 'search', labelKey: 'settings.tab_search' },
  { id: 'storage', labelKey: 'settings.tab_storage' },
  { id: 'help', labelKey: 'settings.tab_help' },
];

export interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfigV2;
  setConfig: React.Dispatch<React.SetStateAction<AIConfigV2>>;
}

export function AISettingsModal({ isOpen, onClose, config, setConfig }: AISettingsModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('general');
  if (!isOpen) return null;

  const activeProviderKind = resolveActiveChatTarget(config).provider?.kind ?? 'custom';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-app-surface-raised rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-app-border flex items-center justify-between bg-app-surface-subtle/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-app-text">{t('settings.title')}</h2>
              <p className="text-[10px] text-app-text-faint uppercase tracking-widest font-mono">
                {t('settings.ai_config')}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="p-2 hover:bg-app-surface-sunken rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-app-text-faint" />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 px-6 pt-4 border-b border-app-border">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`px-4 py-2 text-sm font-bold rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === entry.id
                  ? 'border-app-accent text-app-accent'
                  : 'border-transparent text-app-text-faint hover:text-app-text'
              }`}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto max-h-[65vh]">
          {tab === 'general' && <GeneralSettingsTab />}
          {tab === 'providers' && <ProvidersSettingsTab config={config} onChange={setConfig} />}
          {tab === 'search' && <SearchSettingsTab config={config} onChange={setConfig} />}
          {tab === 'storage' && <StorageSettingsTab />}
          {tab === 'help' && <HelpSettingsTab activeProviderKind={activeProviderKind} />}
        </div>

        <div className="p-6 border-t border-app-border bg-app-surface-raised flex items-center justify-between gap-4">
          {/* 配置是即时保存的，这里只说明一句，避免用户以为不点按钮就丢了 */}
          <p className="text-[11px] text-app-text-faint">{t('settings.save_success')}</p>
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-app-accent text-white rounded-xl font-sans font-bold hover:bg-app-accent-deep transition-all text-sm shadow-sm shadow-app-accent/20 shrink-0"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
