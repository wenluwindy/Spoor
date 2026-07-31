import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus } from 'lucide-react';
import type { AIConfigV2, ProviderKind } from '../../types/aiConfig';
import { addProvider, createProviderFromPreset, removeProvider } from '../../services/aiConfigEdit';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  /**
   * 用 `<input type="file">` 而不是原生文件对话框：配置文件只有几 KB，
   * 走 webview 的 File API 一步到位，不用为读一个 JSON 再开一个能读任意
   * 路径的 Rust 命令。网页端和桌面端还共用同一条路径。
   */
  const handleImportFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportNote({ ok: false, text: t('settings.ccswitch_bad_json') });
      return;
    }

    const { providers, skipped } = parseCcSwitchConfig(parsed);
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

      <div className="pt-1 space-y-2 border-t border-[#F4F1ED]">
        <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider pt-2">
          {t('settings.import_heading')}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 清空 value：同一个文件连选两次也要能触发 change
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#E6E4DF] text-[11px] font-bold text-[#5a5a54] hover:border-[#C2410C]/40 hover:text-[#C2410C] transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {t('settings.ccswitch_import')}
        </button>
        <p className="text-[10px] text-[#8c8a84] leading-relaxed">{t('settings.ccswitch_hint')}</p>
        {importNote && (
          <p
            role="status"
            className={`text-[10px] leading-relaxed ${importNote.ok ? 'text-[#3f7d4f]' : 'text-[#C2410C]'}`}
          >
            {importNote.text}
          </p>
        )}
      </div>
    </div>
  );
}
