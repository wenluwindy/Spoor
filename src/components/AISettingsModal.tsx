import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, X } from 'lucide-react';
import type { AIConfigV2 } from '../types/aiConfig';
import { resolveActiveChatTarget } from '../services/aiConfig';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import { ProvidersSettingsTab } from './settings/ProvidersSettingsTab';
import { StorageSettingsTab } from './settings/StorageSettingsTab';

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
  metasoApiKey?: string;
}

type SettingsTab = 'general' | 'providers' | 'storage';

const TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.tab_general' },
  { id: 'providers', labelKey: 'settings.tab_providers' },
  { id: 'storage', labelKey: 'settings.tab_storage' },
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
      <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-[#E6E4DF] flex items-center justify-between bg-[#F4F1ED]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C2410C]/10 border border-[#C2410C]/20 flex items-center justify-center text-[#C2410C]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-[#1a1a1a]">{t('settings.title')}</h2>
              <p className="text-[10px] text-[#8c8a84] uppercase tracking-widest font-mono">
                {t('settings.ai_config')}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="p-2 hover:bg-[#EAE7E2] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[#8c8a84]" />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 px-6 pt-4 border-b border-[#E6E4DF]">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`px-4 py-2 text-sm font-bold rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === entry.id
                  ? 'border-[#C2410C] text-[#C2410C]'
                  : 'border-transparent text-[#8c8a84] hover:text-[#1a1a1a]'
              }`}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto max-h-[65vh]">
          {tab === 'general' && (
            <GeneralSettingsTab
              config={config}
              onChange={setConfig}
              activeProviderKind={activeProviderKind}
            />
          )}
          {tab === 'providers' && <ProvidersSettingsTab config={config} onChange={setConfig} />}
          {tab === 'storage' && <StorageSettingsTab />}
        </div>

        <div className="p-6 border-t border-[#E6E4DF] bg-white flex items-center justify-between gap-4">
          {/* 配置是即时保存的，这里只说明一句，避免用户以为不点按钮就丢了 */}
          <p className="text-[11px] text-[#8c8a84]">{t('settings.save_success')}</p>
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-[#C2410C] text-white rounded-xl font-sans font-bold hover:bg-[#9A3412] transition-all text-sm shadow-sm shadow-[#C2410C]/20 shrink-0"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
