import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { CanvasNode } from '../../db';
import type { AIConfigV2 } from '../../types/aiConfig';
import { listImageModels, resolveImageModel } from '../../services/aiConfig';
import { collectImageGenInputs, buildImageGenPrompt } from '../../utils/imageGenInputs';
import { mediaUrl } from '../../utils/mediaUrl';
import { MissingMediaPlaceholder } from './MissingMediaPlaceholder';
import { Tooltip } from '../ui/Tooltip';
import { ImageGenSizeField } from './imagegen/ImageGenSizeField';

export interface ImageGenNodeProps {
  node: CanvasNode;
  aiConfig: AIConfigV2;
  /** 同画布的全部节点与连线，用于解析参考图与上游文本。 */
  nodes: CanvasNode[];
  edges: { from: string; to: string }[];
  isGenerating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onDeleteResult: (index: number) => void;
  onSetActiveIndex: (index: number) => void;
}

const FIELD =
  'w-full bg-app-surface border border-app-border rounded-lg text-xs outline-none focus:border-app-accent transition-all';

export function ImageGenNode({
  node,
  aiConfig,
  nodes,
  edges,
  isGenerating,
  onGenerate,
  onCancel,
  onPatch,
  onDeleteResult,
  onSetActiveIndex,
}: ImageGenNodeProps) {
  const { t } = useTranslation();

  /**
   * 上游连了文本卡时默认收起提示词框：那份文本已经是提示词，
   * 这里的输入只是「补充」，摊开占地方还容易让人以为必须填。
   */
  const [promptExpanded, setPromptExpanded] = useState(false);

  const models = listImageModels(aiConfig);
  const target = resolveImageModel(aiConfig, {
    providerId: node.imageGenProviderId,
    modelId: node.imageGenModelId,
  });

  const inputs = collectImageGenInputs(node.id, nodes, edges, {
    maxRefImages: target?.model.capabilities.maxRefImages,
    excludedRefIds: node.imageGenExcludedRefIds,
    ignoreUpstreamText: node.imageGenIgnoreUpstreamText,
  });

  const prompt = buildImageGenPrompt(inputs.upstreamText, node.imageGenPrompt ?? '');
  /** 没有上游文本时提示词框是唯一入口，必须常显；有上游文本时才可折叠。 */
  const promptVisible = !inputs.upstreamText || promptExpanded;
  const results = node.imageGenResults ?? [];
  const activeIndex = Math.min(node.imageGenActiveIndex ?? 0, Math.max(0, results.length - 1));
  const activePath = results[activeIndex];
  const errorCode = node.imageGenErrorCode;
  const canGenerate = Boolean(target) && prompt.length > 0 && !isGenerating;

  // 上游文本被断开后，提示词框恢复常显，免得用户对着一张没有任何输入口的卡片发愣
  useEffect(() => {
    if (!inputs.upstreamText) setPromptExpanded(false);
  }, [inputs.upstreamText]);

  const toggleRef = (nodeId: string) => {
    const excluded = new Set(node.imageGenExcludedRefIds ?? []);
    if (excluded.has(nodeId)) excluded.delete(nodeId);
    else excluded.add(nodeId);
    onPatch({ imageGenExcludedRefIds: [...excluded] });
  };

  /** 邻接的图片节点（含被点掉的），用于画参考图条。 */
  const neighborRefs = collectImageGenInputs(node.id, nodes, edges, {
    maxRefImages: 99,
  }).refImages;

  return (
    <div className="w-full h-full bg-app-surface-raised shadow-lg border-2 border-app-border flex flex-col rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-app-surface-subtle bg-app-surface">
        <Sparkles className="w-3.5 h-3.5 text-app-accent shrink-0" />
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint shrink-0">
          {t('imagegen.title')}
        </span>
        <select
          className="ml-auto min-w-0 max-w-[55%] text-[11px] bg-transparent border border-app-border rounded px-1.5 py-0.5 outline-none focus:border-app-accent"
          aria-label={t('imagegen.model')}
          value={target ? `${target.provider.id}:${target.model.id}` : ''}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split(':');
            onPatch({ imageGenProviderId: providerId, imageGenModelId: modelId });
          }}
        >
          {models.length === 0 && <option value="">{t('imagegen.no_model_option')}</option>}
          {models.map((entry) => (
            <option key={`${entry.provider.id}:${entry.model.id}`} value={`${entry.provider.id}:${entry.model.id}`}>
              {entry.provider.name} · {entry.model.label || entry.model.modelName}
            </option>
          ))}
        </select>
      </div>

      {/* ── 预览区：空 / 生成中 / 完成 / 错误 ── */}
      <div className="flex-1 min-h-[160px] flex items-center justify-center bg-app-surface-subtle relative">
        {isGenerating ? (
          <div className="flex flex-col items-center gap-2 text-app-text-faint">
            <Loader2 className="w-6 h-6 animate-spin text-app-accent" />
            <span className="text-[11px]">{t('imagegen.generating')}</span>
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] font-bold text-app-accent hover:underline"
            >
              {t('imagegen.cancel')}
            </button>
          </div>
        ) : errorCode ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-3 text-center">
            <AlertTriangle className="w-5 h-5 text-app-accent" />
            <span className="text-[11px] text-app-accent leading-snug">
              {t(`imagegen.errors.${errorCode}`, { defaultValue: t('imagegen.errors.unknown') })}
            </span>
            {node.imageGenErrorDetail && (
              <details className="w-full">
                <summary className="text-[10px] text-app-text-faint cursor-pointer">
                  {t('imagegen.error_detail')}
                </summary>
                <p className="text-[10px] text-app-text-faint break-all text-left mt-1">
                  {node.imageGenErrorDetail}
                </p>
              </details>
            )}
            <button
              type="button"
              onClick={onGenerate}
              className="text-[11px] font-bold text-app-accent hover:underline"
            >
              {t('imagegen.retry')}
            </button>
          </div>
        ) : activePath ? (
          <img
            alt={t('imagegen.result_alt')}
            className="w-full h-full object-contain"
            src={mediaUrl(activePath)}
          />
        ) : results.length > 0 ? (
          <MissingMediaPlaceholder />
        ) : (
          <div className="px-6 py-8 text-center text-[11px] text-app-text-faint leading-relaxed border-2 border-dashed border-app-edge m-3 rounded-lg">
            {t('imagegen.empty_hint')}
          </div>
        )}
      </div>

      {/* ── 历史翻页 ── */}
      {results.length > 0 && !isGenerating && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-t border-app-surface-subtle text-[11px] text-app-text-muted">
          <Tooltip label={t('imagegen.prev_result')}>
            <button
              type="button"
              disabled={activeIndex <= 0}
              onClick={() => onSetActiveIndex(activeIndex - 1)}
              className="p-0.5 disabled:opacity-30 hover:text-app-accent transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <span className="font-mono">
            {activeIndex + 1}/{results.length}
          </span>
          <Tooltip label={t('imagegen.next_result')}>
            <button
              type="button"
              disabled={activeIndex >= results.length - 1}
              onClick={() => onSetActiveIndex(activeIndex + 1)}
              className="p-0.5 disabled:opacity-30 hover:text-app-accent transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip label={t('imagegen.delete_result')}>
            <button
              type="button"
              onClick={() => onDeleteResult(activeIndex)}
              className="p-0.5 ml-1 hover:text-app-accent transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* ── 参考图条 ── */}
      {neighborRefs.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-app-surface-subtle flex-wrap">
          <span className="text-[10px] text-app-text-faint shrink-0">{t('imagegen.references')}</span>
          {neighborRefs.map((ref) => {
            const excluded = (node.imageGenExcludedRefIds ?? []).includes(ref.nodeId);
            return (
              <Tooltip
                key={ref.nodeId}
                label={excluded ? t('imagegen.ref_enable') : t('imagegen.ref_disable')}
              >
                <button
                  type="button"
                  onClick={() => toggleRef(ref.nodeId)}
                  className={`w-7 h-7 rounded border overflow-hidden shrink-0 transition-opacity ${
                    excluded ? 'opacity-30 border-app-border' : 'border-app-accent/40'
                  }`}
                >
                  <img
                    alt=""
                    className="w-full h-full object-cover"
                    src={ref.spec.startsWith('data:') ? ref.spec : mediaUrl(ref.spec)}
                  />
                </button>
              </Tooltip>
            );
          })}
          {inputs.ignoredRefCount > 0 && (
            <span className="text-[10px] text-app-accent">
              {t('imagegen.refs_ignored', { count: inputs.ignoredRefCount })}
            </span>
          )}
        </div>
      )}

      {/* ── 提示词与生成 ── */}
      <div className="px-3 py-2 border-t border-app-surface-subtle space-y-2">
        {inputs.upstreamText ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-app-text-faint cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-app-border"
                  checked={node.imageGenIgnoreUpstreamText ?? false}
                  onChange={(e) => onPatch({ imageGenIgnoreUpstreamText: e.target.checked })}
                />
                {t('imagegen.ignore_upstream')}
              </label>
              <button
                type="button"
                onClick={() => setPromptExpanded((v) => !v)}
                className="ml-auto flex items-center gap-1 text-[10px] text-app-text-faint hover:text-app-accent transition-colors"
              >
                {promptExpanded ? t('imagegen.prompt_collapse') : t('imagegen.prompt_expand')}
                {promptExpanded ? (
                  <ChevronUp className="w-3 h-3" aria-hidden />
                ) : (
                  <ChevronDown className="w-3 h-3" aria-hidden />
                )}
              </button>
            </div>
            {!promptExpanded && (
              <p className="text-[10px] text-app-text-faint truncate" title={inputs.upstreamText}>
                {t('imagegen.upstream_as_prompt')}
              </p>
            )}
          </div>
        ) : null}
        {promptVisible && (
          <textarea
            className={`${FIELD} px-2 py-1.5 resize-none max-h-[100px]`}
            rows={2}
            aria-label={t('imagegen.prompt')}
            placeholder={
              inputs.upstreamText ? t('imagegen.prompt_placeholder_with_upstream') : t('imagegen.prompt_placeholder')
            }
            value={node.imageGenPrompt ?? ''}
            onChange={(e) => onPatch({ imageGenPrompt: e.target.value })}
          />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <ImageGenSizeField
            sizeOptions={target?.model.sizeOptions}
            defaultSize={target?.model.defaultParams?.size}
            value={node.imageGenParams?.size}
            onChange={(size) => onPatch({ imageGenParams: { ...node.imageGenParams, size } })}
          />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="ml-auto px-4 py-1.5 bg-app-accent text-white rounded-lg text-xs font-bold hover:bg-app-accent-deep transition-colors disabled:opacity-40 shrink-0 flex items-center gap-1.5"
          >
            {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {t('imagegen.generate')}
          </button>
        </div>
        {!target && <p className="text-[10px] text-app-accent">{t('imagegen.need_model')}</p>}
        {target && !prompt && <p className="text-[10px] text-app-text-faint">{t('imagegen.need_prompt')}</p>}
        {inputs.hasImageGenNeighbor && (
          <p className="text-[10px] text-app-text-faint">{t('imagegen.chain_hint')}</p>
        )}
      </div>
    </div>
  );
}
