import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
} from 'lucide-react';
import type { AIConfigV2, AIProviderProfile, ProviderKind } from '../../types/aiConfig';
import {
  PRESET_IMAGE_MODELS,
  supportsImageGeneration,
} from '../../constants/aiProviderPresets';
import {
  addChatModel,
  addImageModel,
  changeProviderKind,
  removeChatModel,
  removeImageModel,
  setActiveChat,
  setDefaultImage,
  updateChatModel,
  updateImageModel,
  updateProvider,
} from '../../services/aiConfigEdit';
import { testChatModel, type ConnectivityResult } from '../../services/aiConfigTest';
import { resolveErrorMessage } from '../../utils/resolveErrorMessage';
import { Tooltip } from '../ui/Tooltip';

const PROVIDER_KINDS: ProviderKind[] = [
  'doubao',
  'openai',
  'gemini',
  'anthropic',
  'deepseek',
  'mimo',
  'custom',
  'local_llama',
];

const FIELD =
  'w-full h-9 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all';
const META_LABEL =
  'text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider';

export interface ProviderEditorProps {
  config: AIConfigV2;
  provider: AIProviderProfile;
  onChange: (next: AIConfigV2) => void;
  onRequestDelete: (provider: AIProviderProfile) => void;
}

export function ProviderEditor({
  config,
  provider,
  onChange,
  onRequestDelete,
}: ProviderEditorProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, ConnectivityResult>>({});

  const isLocal = provider.kind === 'local_llama';
  const canGenerateImages = supportsImageGeneration(provider.kind);
  const imagePresets = PRESET_IMAGE_MODELS[provider.kind] ?? [];

  const runTest = async (modelId: string, modelName: string) => {
    setTestingModelId(modelId);
    const result = await testChatModel(provider, modelName);
    setTestResult((prev) => ({ ...prev, [modelId]: result }));
    setTestingModelId(null);
  };

  return (
    <div className="border border-[#E6E4DF] rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#FAF9F6] border-b border-[#E6E4DF]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('settings.collapse_provider') : t('settings.expand_provider')}
          className="p-1 text-[#8c8a84] hover:text-[#1a1a1a] transition-colors"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <input
          className="flex-1 min-w-0 bg-transparent text-sm font-bold text-[#1a1a1a] outline-none focus:bg-white rounded px-1 py-0.5 transition-colors"
          value={provider.name}
          aria-label={t('settings.provider_name')}
          onChange={(e) => onChange(updateProvider(config, provider.id, { name: e.target.value }))}
        />
        {config.activeChat.providerId === provider.id && (
          <span className="text-[10px] font-mono text-[#C2410C] border border-[#C2410C]/30 rounded px-1.5 py-0.5 shrink-0">
            {t('settings.badge_active_chat')}
          </span>
        )}
        <Tooltip label={t('settings.delete_provider')}>
          <button
            type="button"
            onClick={() => onRequestDelete(provider)}
            className="p-1 text-[#8c8a84] hover:text-[#C2410C] transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={META_LABEL} htmlFor={`kind-${provider.id}`}>
                {t('settings.provider')}
              </label>
              <select
                id={`kind-${provider.id}`}
                className={FIELD}
                value={provider.kind}
                onChange={(e) =>
                  onChange(changeProviderKind(config, provider.id, e.target.value as ProviderKind))
                }
              >
                {PROVIDER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`settings.provider_kind.${kind}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={META_LABEL} htmlFor={`base-${provider.id}`}>
                {t('settings.base_url')}
              </label>
              <input
                id={`base-${provider.id}`}
                className={FIELD}
                value={provider.baseUrl}
                disabled={isLocal}
                onChange={(e) =>
                  onChange(updateProvider(config, provider.id, { baseUrl: e.target.value }))
                }
              />
            </div>
          </div>

          {isLocal ? (
            <div className="space-y-1.5">
              <label className={META_LABEL} htmlFor={`gguf-${provider.id}`}>
                {t('settings.local_gguf_path')}
              </label>
              <input
                id={`gguf-${provider.id}`}
                className={`${FIELD} font-mono`}
                placeholder={t('settings.local_gguf_placeholder')}
                value={provider.localGgufPath ?? ''}
                onChange={(e) =>
                  onChange(updateProvider(config, provider.id, { localGgufPath: e.target.value }))
                }
              />
              <label className="flex items-center gap-2 text-[11px] text-[#5a5a54] cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-[#E6E4DF]"
                  checked={provider.localEnableThinking ?? false}
                  onChange={(e) =>
                    onChange(
                      updateProvider(config, provider.id, {
                        localEnableThinking: e.target.checked,
                      }),
                    )
                  }
                />
                {t('settings.local_enable_thinking')}
              </label>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={META_LABEL} htmlFor={`key-${provider.id}`}>
                {t('settings.api_key')}
              </label>
              <input
                id={`key-${provider.id}`}
                type="password"
                className={FIELD}
                value={provider.apiKey}
                onChange={(e) =>
                  onChange(updateProvider(config, provider.id, { apiKey: e.target.value }))
                }
              />
            </div>
          )}

          {/* ── 对话模型 ── */}
          <section className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-[#5a5a54]" />
              <span className={META_LABEL}>{t('settings.chat_models')}</span>
            </div>

            {provider.kind === 'doubao' && (
              <p className="text-[10px] text-[#8c8a84] leading-relaxed">
                {t('settings.doubao_model_hint')}
              </p>
            )}

            {provider.chatModels.map((model) => {
              const isActive =
                config.activeChat.providerId === provider.id &&
                config.activeChat.modelId === model.id;
              const result = testResult[model.id];
              return (
                <div key={model.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      className={`${FIELD} flex-1`}
                      placeholder={t('settings.model_name_placeholder')}
                      aria-label={t('settings.model')}
                      value={model.modelName}
                      onChange={(e) =>
                        onChange(
                          updateChatModel(config, provider.id, model.id, {
                            modelName: e.target.value,
                            label: e.target.value,
                          }),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => onChange(setActiveChat(config, provider.id, model.id))}
                      className={`h-9 px-2.5 rounded-lg text-[11px] font-bold border transition-colors shrink-0 ${
                        isActive
                          ? 'border-[#C2410C] bg-[#C2410C]/5 text-[#C2410C]'
                          : 'border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/40'
                      }`}
                    >
                      {isActive ? t('settings.is_default') : t('settings.set_default')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runTest(model.id, model.modelName)}
                      disabled={testingModelId !== null}
                      className="h-9 px-2.5 rounded-lg text-[11px] font-bold border border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/40 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                    >
                      {testingModelId === model.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : null}
                      {t('settings.test')}
                    </button>
                    <Tooltip label={t('settings.delete_model')}>
                      <button
                        type="button"
                        onClick={() => onChange(removeChatModel(config, provider.id, model.id))}
                        className="p-1.5 text-[#8c8a84] hover:text-[#C2410C] transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                  {result?.ok === true && (
                    <p className="text-[10px] leading-relaxed text-[#3f7d4f]">
                      {t('settings.test_ok')}
                    </p>
                  )}
                  {result?.ok === false && (
                    <p className="text-[10px] leading-relaxed text-[#C2410C]">
                      {t('settings.test_failed')}
                      {resolveErrorMessage(result.error, t)}
                    </p>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => onChange(addChatModel(config, provider.id))}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#C2410C] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('settings.add_chat_model')}
            </button>
          </section>

          {/* ── 生图模型 ── */}
          {canGenerateImages && (
            <section className="space-y-2 pt-1 border-t border-[#F4F1ED]">
              <div className="flex items-center gap-1.5 pt-2">
                <ImageIcon className="w-3.5 h-3.5 text-[#5a5a54]" />
                <span className={META_LABEL}>{t('settings.image_models')}</span>
              </div>

              {provider.imageModels.map((model) => {
                const isDefault =
                  config.defaultImage?.providerId === provider.id &&
                  config.defaultImage?.modelId === model.id;
                return (
                  <div key={model.id} className="flex items-center gap-2">
                    <input
                      className={`${FIELD} flex-1`}
                      placeholder={t('settings.model_name_placeholder')}
                      aria-label={t('settings.image_model_name')}
                      value={model.modelName}
                      onChange={(e) =>
                        onChange(
                          updateImageModel(config, provider.id, model.id, {
                            modelName: e.target.value,
                            label: model.label || e.target.value,
                          }),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => onChange(setDefaultImage(config, provider.id, model.id))}
                      className={`h-9 px-2.5 rounded-lg text-[11px] font-bold border transition-colors shrink-0 ${
                        isDefault
                          ? 'border-[#C2410C] bg-[#C2410C]/5 text-[#C2410C]'
                          : 'border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/40'
                      }`}
                    >
                      {isDefault ? t('settings.is_default') : t('settings.set_default')}
                    </button>
                    <Tooltip label={t('settings.delete_model')}>
                      <button
                        type="button"
                        onClick={() => onChange(removeImageModel(config, provider.id, model.id))}
                        className="p-1.5 text-[#8c8a84] hover:text-[#C2410C] transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onChange(addImageModel(config, provider.id))}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#C2410C] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('settings.add_image_model')}
                </button>
                {imagePresets.map((preset) => (
                  <button
                    key={preset.modelName}
                    type="button"
                    onClick={() => onChange(addImageModel(config, provider.id, preset))}
                    className="text-[11px] text-[#5a5a54] hover:text-[#C2410C] hover:underline"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
