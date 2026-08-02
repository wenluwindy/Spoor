import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanvasNode } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI, formatAiError } from '../services/ai';
import { useAppDialog } from '../components/AppDialogProvider';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import {
  applyOrganizePlanRecorded,
  buildOrganizeCardList,
  parseOrganizeResponse,
  planOrganizeLayout,
} from '../services/canvasOrganize';
import {
  getPendingOrganizePlan,
  setPendingOrganizePlan,
} from '../services/organizePreview';
import { resolveErrorMessage } from '../utils/resolveErrorMessage';
import { logger } from '../utils/logger';

/**
 * AI 整理画布的编排：收集选中卡的正文 → 让模型分组 → 摆出预览虚影 →
 * 应用（一步撤销）或取消。AI 只管语义分组，坐标全部本地算（见 canvasOrganize）。
 */
export function useCanvasOrganize(params: {
  aiConfig: AIConfig;
  activeCanvasId: string;
  dynamicNodes: CanvasNode[];
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
}) {
  const { aiConfig, activeCanvasId, dynamicNodes, nodesRef } = params;
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [isOrganizing, setIsOrganizing] = useState(false);

  // 切画布时丢弃悬而未决的预览：虚影属于算它时的那张画布
  useEffect(() => {
    setPendingOrganizePlan(null);
  }, [activeCanvasId]);

  const runOrganize = useCallback(
    async (nodeIds: string[]) => {
      // 区域框是背景不是内容，不参与分组
      const targets = dynamicNodes.filter((n) => nodeIds.includes(n.id) && n.type !== 'frame');
      if (targets.length < 3 || isOrganizing) return;
      setIsOrganizing(true);
      try {
        const cards = buildOrganizeCardList(targets, (node) => {
          const el = nodesRef.current[node.id];
          const fromDom = el ? getCanvasNodeContextText(el) : '';
          return fromDom || node.content || node.urlTitle || node.fileName || '';
        });
        const text = await callUniversalAI({
          config: aiConfig,
          systemInstruction: combineSystemParts(t('ai.prompts.organizeSystem'), getLocaleDirective()),
          prompt: t('ai.prompts.organizeUser', { cards, count: targets.length }),
          // 分类任务要的是稳定，不是创意
          temperature: 0.2,
        });
        const groups = parseOrganizeResponse(text ?? '', new Set(targets.map((n) => n.id)));
        if (!groups) {
          void appAlert({ message: t('canvas.organize_parse_failed') });
          return;
        }
        setPendingOrganizePlan(planOrganizeLayout(activeCanvasId, groups, targets));
      } catch (e) {
        logger.error('ai', 'organize canvas failed', { error: formatAiError(e) });
        void appAlert({ message: `${t('canvas.organize_failed')}\n\n${resolveErrorMessage(e, t)}` });
      } finally {
        setIsOrganizing(false);
      }
    },
    [dynamicNodes, isOrganizing, nodesRef, aiConfig, t, appAlert, activeCanvasId],
  );

  const applyPendingOrganize = useCallback(async () => {
    const plan = getPendingOrganizePlan();
    if (!plan) return;
    await applyOrganizePlanRecorded(plan);
    setPendingOrganizePlan(null);
  }, []);

  const cancelPendingOrganize = useCallback(() => setPendingOrganizePlan(null), []);

  return { isOrganizing, runOrganize, applyPendingOrganize, cancelPendingOrganize };
}
