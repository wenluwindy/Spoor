import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { AIConfigV2, ProviderKind } from '../../types/aiConfig';
import { addProvider, createProviderFromPreset, removeProvider } from '../../services/aiConfigEdit';
import { useAppDialog } from '../AppDialogProvider';
import { ProviderEditor } from './ProviderEditor';

/** 「添加服务」的快捷预设。其余类型加完之后在服务商里改类型即可。 */
const QUICK_PRESETS: ProviderKind[] = ['doubao', 'openai', 'gemini', 'custom'];

export interface ProvidersSettingsTabProps {
  config: AIConfigV2;
  onChange: (next: AIConfigV2) => void;
}

export function ProvidersSettingsTab({ config, onChange }: ProvidersSettingsTabProps) {
  const { t } = useTranslation();
  const { confirm } = useAppDialog();
  const [busy, setBusy] = useState(false);

  const requestDelete = async (providerId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await confirm({
        title: t('settings.delete_provider'),
        message: t('settings.delete_provider_confirm', { name }),
        confirmLabel: t('settings.delete_provider_ok'),
        variant: 'danger',
      });
      if (ok) onChange(removeProvider(config, providerId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {config.providers.length === 0 && (
        <p className="text-[11px] text-[#8c8a84] leading-relaxed">{t('settings.providers_empty')}</p>
      )}

      {config.providers.map((provider) => (
        <ProviderEditor
          key={provider.id}
          config={config}
          provider={provider}
          onChange={onChange}
          onRequestDelete={(p) => void requestDelete(p.id, p.name)}
        />
      ))}

      <div className="pt-1 space-y-2">
        <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
          {t('settings.add_provider')}
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PRESETS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange(addProvider(config, createProviderFromPreset(kind)))}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#E6E4DF] text-[11px] font-bold text-[#5a5a54] hover:border-[#C2410C]/40 hover:text-[#C2410C] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t(`settings.provider_kind.${kind}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
