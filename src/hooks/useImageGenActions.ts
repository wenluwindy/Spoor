import { useCallback, useState } from 'react';
import { db, type CanvasNode, type Edge } from '../db';
import type { AIConfigV2 } from '../types/aiConfig';
import { resolveImageModel } from '../services/aiConfig';
import {
  cancelImageGeneration,
  generateImages,
  isImageGenFailure,
} from '../services/imageGen';
import { buildImageGenPrompt, collectImageGenInputs } from '../utils/imageGenInputs';

/**
 * 生图节点的动作。
 *
 * 「生成中」刻意**不入库**：写进 IndexedDB 的话，生成途中关掉应用，下次打开
 * 那张卡会永远卡在转圈上。放内存里，重启即回到可重试的状态。
 */

/** 结果卡片相对生图节点的落点：右侧一屏宽，多张依次下移。 */
const RESULT_CARD_OFFSET_X = 380;
const RESULT_CARD_STAGGER_Y = 300;

export interface UseImageGenActionsParams {
  aiConfig: AIConfigV2;
  activeCanvasId: string;
  nodes: CanvasNode[];
  edges: Pick<Edge, 'from' | 'to'>[];
}

export function useImageGenActions({
  aiConfig,
  activeCanvasId,
  nodes,
  edges,
}: UseImageGenActionsParams) {
  const [generatingNodeIds, setGeneratingNodeIds] = useState<Set<string>>(new Set());
  /** nodeId → taskId，用于取消。 */
  const [taskIds, setTaskIds] = useState<Record<string, string>>({});

  const markGenerating = useCallback((nodeId: string, on: boolean) => {
    setGeneratingNodeIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  const generate = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || generatingNodeIds.has(nodeId)) return;

      const target = resolveImageModel(aiConfig, {
        providerId: node.imageGenProviderId,
        modelId: node.imageGenModelId,
      });
      if (!target) {
        await db.nodes.update(nodeId, { imageGenErrorCode: 'no_model', imageGenErrorDetail: '' });
        return;
      }

      const inputs = collectImageGenInputs(nodeId, nodes, edges, {
        maxRefImages: target.model.capabilities.maxRefImages,
        excludedRefIds: node.imageGenExcludedRefIds,
        ignoreUpstreamText: node.imageGenIgnoreUpstreamText,
      });
      const prompt = buildImageGenPrompt(inputs.upstreamText, node.imageGenPrompt ?? '');
      if (!prompt) {
        await db.nodes.update(nodeId, { imageGenErrorCode: 'no_prompt', imageGenErrorDetail: '' });
        return;
      }

      const taskId = crypto.randomUUID();
      setTaskIds((prev) => ({ ...prev, [nodeId]: taskId }));
      markGenerating(nodeId, true);
      await db.nodes.update(nodeId, { imageGenErrorCode: '', imageGenErrorDetail: '' });

      try {
        const results = await generateImages({
          taskId,
          target,
          prompt,
          refImages: inputs.refImages.map((r) => r.spec),
          size: node.imageGenParams?.size,
          n: node.imageGenParams?.n,
        });

        // 最新在前；历史不设上限（决策 11）
        const previous = node.imageGenResults ?? [];
        await db.nodes.update(nodeId, {
          imageGenResults: [...results, ...previous],
          imageGenActiveIndex: 0,
          imageGenProviderId: target.provider.id,
          imageGenModelId: target.model.id,
        });

        // 每次成功生成都在右侧留一张结果卡片并连线，画布上因此形成一条可见的生成脉络。
        // 已有几张就往下错开几行，避免叠在一起。
        const existingResultCards = await db.nodes
          .where('canvasId')
          .equals(activeCanvasId)
          .filter((n) => n.type === 'image' && Boolean(n.imageGenMeta))
          .toArray();
        const siblings = existingResultCards.filter((card) =>
          edges.some((e) => e.from === nodeId && e.to === card.id),
        ).length;

        const resultId = crypto.randomUUID();
        await db.nodes.add({
          id: resultId,
          canvasId: activeCanvasId,
          type: 'image',
          filePath: results[0],
          x: node.x + RESULT_CARD_OFFSET_X,
          y: node.y + siblings * RESULT_CARD_STAGGER_Y,
          imageGenMeta: {
            prompt,
            providerName: target.provider.name,
            modelName: target.model.label || target.model.modelName,
            size: node.imageGenParams?.size ?? target.model.defaultParams?.size,
            refPaths: inputs.refImages.map((r) => r.spec),
            createdAt: Date.now(),
          },
        });
        await db.edges.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          from: nodeId,
          to: resultId,
        });
      } catch (e) {
        const failure = isImageGenFailure(e) ? e : { code: 'unknown', detail: String(e) };
        await db.nodes.update(nodeId, {
          imageGenErrorCode: failure.code,
          imageGenErrorDetail: failure.detail ?? '',
        });
      } finally {
        markGenerating(nodeId, false);
        setTaskIds((prev) => {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
      }
    },
    [activeCanvasId, aiConfig, edges, generatingNodeIds, markGenerating, nodes],
  );

  const cancel = useCallback(
    async (nodeId: string) => {
      const taskId = taskIds[nodeId];
      if (taskId) await cancelImageGeneration(taskId);
    },
    [taskIds],
  );

  /** 删掉历史里的某一张。只从节点上摘掉引用，文件留给资产管理器处理。 */
  const deleteResult = useCallback(async (nodeId: string, index: number) => {
    const node = await db.nodes.get(nodeId);
    if (!node?.imageGenResults) return;
    const results = node.imageGenResults.filter((_, i) => i !== index);
    await db.nodes.update(nodeId, {
      imageGenResults: results,
      imageGenActiveIndex: Math.min(node.imageGenActiveIndex ?? 0, Math.max(0, results.length - 1)),
    });
  }, []);

  const setActiveIndex = useCallback(async (nodeId: string, index: number) => {
    await db.nodes.update(nodeId, { imageGenActiveIndex: index });
  }, []);

  const patchNode = useCallback(async (nodeId: string, patch: Partial<CanvasNode>) => {
    await db.nodes.update(nodeId, patch);
  }, []);

  /**
   * 把当前结果输出成一个独立的 image 节点并自动连线。
   *
   * **复用同一个 filePath，不复制文件**——同一张图在磁盘上只存一份。
   */
  const outputAsImageNode = useCallback(
    async (nodeId: string) => {
      const node = await db.nodes.get(nodeId);
      const results = node?.imageGenResults ?? [];
      if (!node || results.length === 0) return;

      const filePath = results[node.imageGenActiveIndex ?? 0] ?? results[0];
      const newId = crypto.randomUUID();
      await db.nodes.add({
        id: newId,
        canvasId: activeCanvasId,
        type: 'image',
        filePath,
        x: node.x + 380,
        y: node.y,
      });
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        from: nodeId,
        to: newId,
      });
    },
    [activeCanvasId],
  );

  return {
    generatingNodeIds,
    generate,
    cancel,
    deleteResult,
    setActiveIndex,
    patchNode,
    outputAsImageNode,
  };
}
