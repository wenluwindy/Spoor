import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus } from 'lucide-react';
import type { AIConfigV2, ProviderKind } from '../../types/aiConfig';
import { addProvider, createProviderFromPreset, removeProvider } from '../../services/aiConfigEdit';
import { readCcSwitchConfig } from '../../services/ccSwitchConfig';
import { mergeCcSwitchProviders, parseCcSwitchConfig } from '../../services/ccSwitchImport';
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
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

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

  const handleCcSwitchImport = async () => {
    if (busy) return;
    setBusy(true);
    setImportNote(null);
    try {
      const result = await readCcSwitchConfig();
      if (result.status === 'not_installed') {
        setImportNote({ ok: false, text: t('settings.ccswitch_not_installed') });
        return;
      }
      if (result.status === 'read_failed') {
        setImportNote({ ok: false, text: t('settings.ccswitch_read_failed') });
        return;
      }

      const { providers, skipped } = parseCcSwitchConfig(result.config);
      if (providers.length === 0) {
        setImportNote({ ok: false, text: t('settings.ccswitch_none') });
        return;
      }

      const merged = mergeCcSwitchProviders(config, providers);
      onChange(merged.config);
      setImportNote({
        ok: merged.added > 0,
        text: t('settings.ccswitch_result', {
          added: merged.added,
          duplicates: merged.duplicates,
          skipped,
        }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {config.providers.length === 0 && (
        <p className="text-[11px] text-app-text-faint leading-relaxed">{t('settings.providers_empty')}</p>
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
        <p className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider">
          {t('settings.add_provider')}
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PRESETS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange(addProvider(config, createProviderFromPreset(kind)))}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-app-border text-[11px] font-bold text-app-text-muted hover:border-app-accent/40 hover:text-app-accent transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t(`settings.provider_kind.${kind}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-1 space-y-2 border-t border-app-surface-subtle">
        <p className="text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider pt-2">
          {t('settings.import_heading')}
        </p>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void handleCcSwitchImport()}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-app-border text-[11px] font-bold text-app-text-muted hover:border-app-accent/40 hover:text-app-accent disabled:cursor-wait disabled:opacity-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {t('settings.ccswitch_import')}
        </button>
        <p className="text-[10px] text-app-text-faint leading-relaxed">{t('settings.ccswitch_hint')}</p>
        {importNote && (
          <p
            role="status"
            className={`text-[10px] leading-relaxed ${importNote.ok ? 'text-[#3f7d4f]' : 'text-app-accent'}`}
          >
            {importNote.text}
          </p>
        )}
      </div>
    </div>
  );
}
