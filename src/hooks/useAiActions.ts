import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, CanvasNode, Edge as DbEdge } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import type { CanvasTransform } from './useCanvasInteraction';
import { callUniversalAI, formatAiError, maskApiKeyForLog } from '../services/ai';
import { webSearch } from '../services/search';
import { DEFAULT_SEARCH_PROVIDER } from '../constants/searchProviders';
import { deriveSearchQueryFromNoteText, spawnWebSearchCardsFromPages } from '../services/spawnWebSearchNoteCards';
import { parseThreadWebSearchIntent } from '../utils/webSearchCommand';
import { shouldPreflightToolbarIntent } from '../utils/toolbarIntentGate';
import { analyzeToolbarIntentPreflight } from '../services/toolbarIntentClarification';
import { looksLikeCanvasNodeRequest } from '../utils/canvasNodeRequestGate';
import { planCanvasNodes, type PlannedCanvasNode } from '../services/canvasNodePlanner';
import { layoutPlannedNodes } from '../utils/planNodePlacement';
import {
  buildAttachmentContextText,
  collectAttachmentImages,
  fileToToolbarAttachment,
} from '../utils/toolbarAttachments';
import type { ToolbarAttachment } from '../constants/toolbarAttachments';
import { getCanvasCenterPosition } from '../utils/canvas';
import { buildAgentSystemInstruction, combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { collectAiThreadChain, formatAgentThreadDialogueHistory } from '../utils/agentThreadContext';
import {
  collectAgentContextImagePayload,
  resolveImageDataUrlsFromNodeIds,
} from '../utils/canvasContextImages';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { parsePublishArticleResponse } from '../utils/parsePublishArticleResponse';
import { db } from '../db';
import { useAppDialog } from '../components/AppDialogProvider';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { resolveErrorMessage } from '../utils/resolveErrorMessage';
import { logger } from '../utils/logger';

type TranslateFn = (key: string) => string;

/** AI 调用失败时的统一提示：本地化原因 + 排查指引 + 日志入口。 */
function formatAiFailureAlertMessage(e: unknown, t: TranslateFn): string {
  return [
    t('ai.generate_failed'),
    resolveErrorMessage(e, t),
    t('errors.check_settings_hint'),
    t('errors.console_hint'),
  ].join('\n\n');
}

interface UseAiActionsParams {
  aiConfig: AIConfig;
  agentConfigs: AgentConfig[];
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  transformRef: RefObject<CanvasTransform>;
  dynamicNodes: CanvasNode[];
  edges: DbEdge[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveReferenceId: (id: string) => void;
  setActiveTab: (tab: string) => void;
}

export function useAiActions({
  aiConfig,
  agentConfigs,
  activeCanvasId,
  nodesRef,
  transformRef,
  dynamicNodes,
  edges,
  selectedNodes,
  setSelectedNodes,
  setActiveReferenceId,
  setActiveTab,
}: UseAiActionsParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isToolbarAiLoading, setIsToolbarAiLoading] = useState(false);
  const [analyzingAgentNodeId, setAnalyzingAgentNodeId] = useState<string | null>(null);
  const [followUpParentId, setFollowUpParentId] = useState<string | null>(null);
  const [streamingAiNodeId, setStreamingAiNodeId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [intentClarification, setIntentClarification] = useState<{
    original: string;
    options: [string, string, string];
    hint?: string;
  } | null>(null);
  const [isToolbarIntentPreflight, setIsToolbarIntentPreflight] = useState(false);
  const [attachments, setAttachments] = useState<ToolbarAttachment[]>([]);
  const followUpGuardRef = useRef(false);

  const THREAD_GAP = 24;

  /** 输入栏附件：只作为这一次提问的上下文，不落画布。发送成功后清空。 */
  const addAttachments = async (files: File[]) => {
    for (const file of files) {
      try {
        const attachment = await fileToToolbarAttachment(file);
        setAttachments((prev) => [...prev, attachment]);
      } catch (e) {
        void appAlert({ message: resolveErrorMessage(e, t) });
      }
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const clearAttachments = () => setAttachments([]);

  const attachmentContextText = () =>
    buildAttachmentContextText(attachments, (name) => t('ai.attachment_context_label', { name }));

  const isAnyAiBusy =
    isPublishing ||
    isToolbarAiLoading ||
    isToolbarIntentPreflight ||
    analyzingAgentNodeId !== null ||
    followUpParentId !== null ||
    intentClarification !== null;

  const handlePublish = async () => {
    if (selectedNodes.size === 0 || isAnyAiBusy) return;
    setIsPublishing(true);
    try {
      let combinedText = '';
      for (const id of Array.from(selectedNodes)) {
        const el = nodesRef.current[id];
        if (el) {
          combinedText += getCanvasNodeContextText(el) + '\n\n';
        }
      }

      const text = await callUniversalAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('ai.prompts.publish', { content: combinedText }),
      });

      const { title, body } = parsePublishArticleResponse(text || '', t('ai.generated_article_title'));

      const newArticle = {
        id: `gen-${Date.now()}`,
        title,
        content: body,
        date: new Date().getFullYear().toString(),
        type: 'GEN-' + Math.floor(Math.random() * 1000),
        tags: [] as string[],
        linkedCanvasIds: [activeCanvasId],
        author: '',
      };

      await db.articles.add(newArticle);
      setActiveReferenceId(newArticle.id);
      setActiveTab('reference');
      setSelectedNodes(new Set());
    } catch (e) {
      logger.error('ai', 'handlePublish failed', { error: formatAiError(e), provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: `${t('ai.publish_failed')}\n\n${resolveErrorMessage(e, t)}\n\n${t('errors.console_hint')}`,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const triggerAgentAnalysis = async (agentConfigId: string, agentNodeId: string, contextNodeId: string) => {
    const agentConfig = agentConfigs.find(a => a.id === agentConfigId);
    if (!agentConfig) return;

    const contextEl = nodesRef.current[contextNodeId];
    if (!contextEl) return;

    const contextText = getCanvasNodeContextText(contextEl);
    if (!contextText.trim()) return;

    setAnalyzingAgentNodeId(agentNodeId);
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId);
    const x = agentNode ? agentNode.x + 350 : window.innerWidth / 2;
    const y = agentNode ? agentNode.y : window.innerHeight / 2;
    const { nodeIds: threadContextImageNodeIds, dataUrls: contextImageDataUrls } =
      collectAgentContextImagePayload(contextNodeId, agentNodeId, dynamicNodes, edges);

    try {
      await createAiCardAndStream({
        node: {
          x,
          y,
          threadRootContextNodeId: contextNodeId,
          threadAgentConfigId: agentConfigId,
          ...(threadContextImageNodeIds.length > 0 ? { threadContextImageNodeIds } : {}),
        },
        edgeFrom: agentNodeId,
        callAi: (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            prompt: t('ai.prompts.agentContext', { content: contextText }),
            systemInstruction: buildAgentSystemInstruction(agentConfig),
            temperature: agentConfig.temperature ?? 0.7,
            topP: agentConfig.creativity ?? 0.4,
            images: contextImageDataUrls.length > 0 ? contextImageDataUrls : undefined,
            onStreamChunk,
          }),
      });
    } catch (e) {
      const msg = formatAiError(e);
      logger.error('ai', 'triggerAgentAnalysis failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: formatAiFailureAlertMessage(e, t),
      });
    } finally {
      setAnalyzingAgentNodeId(null);
    }
  };

  /**
   * 「建一张 AI 卡（可选从来源连一条边）→ 流式生成 → 收拾」的唯一出口。
   *
   * 收拾的规则：模型什么都没给或者抛错时，`runCanvasStreamingAiCall` 会删掉这张
   * 新建的卡（create 模式），这里负责把那条一起建的边也删掉——半根悬空的线
   * 比没有线更糟。错误继续向上抛，提示与日志由调用方按各自场景处理。
   */
  const createAiCardAndStream = async (params: {
    node: Partial<CanvasNode> & { x: number; y: number };
    /** 传了就从这个节点连一条边到新卡。 */
    edgeFrom?: string;
    callAi: (onStreamChunk: (accumulated: string) => void) => Promise<string>;
  }): Promise<{ nodeId: string; text: string }> => {
    const nodeId = crypto.randomUUID();
    const edgeId = params.edgeFrom ? crypto.randomUUID() : null;
    await db.nodes.add({
      id: nodeId,
      canvasId: activeCanvasId,
      type: 'ai',
      content: '',
      ...params.node,
    });
    if (params.edgeFrom && edgeId) {
      await db.edges.add({
        id: edgeId,
        canvasId: activeCanvasId,
        from: params.edgeFrom,
        to: nodeId,
      });
    }
    setStreamingAiNodeId(nodeId);
    try {
      const text = await runCanvasStreamingAiCall({ nodeId, callAi: params.callAi });
      if (!text && edgeId) await db.edges.delete(edgeId);
      return { nodeId, text };
    } catch (e) {
      if (edgeId) {
        try {
          await db.edges.delete(edgeId);
        } catch {
          /* edge may be gone with node */
        }
      }
      throw e;
    } finally {
      setStreamingAiNodeId(null);
    }
  };

  const runToolbarAiGeneration = async (request: string) => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    // 附件是这一次提问的上下文：图片走多模态入参，文档正文拼进提示词
    const attachmentImages = collectAttachmentImages(attachments);
    const attachmentText = attachmentContextText();
    const images = attachmentImages.length > 0 ? attachmentImages : undefined;
    const withAttachments = (prompt: string) =>
      attachmentText ? `${attachmentText}\n\n${prompt}` : prompt;

    // 有选中卡片就带着它们的正文问；没有就当普通提问
    let callAi: (onStreamChunk: (accumulated: string) => void) => Promise<string>;
    if (selectedNodes.size === 0) {
      callAi = (onStreamChunk) =>
        callUniversalAI({
          config: aiConfig,
          systemInstruction: combineSystemParts(
            t('ai.prompts.toolbarBarePersona'),
            getLocaleDirective(),
          ),
          prompt: withAttachments(request),
          images,
          onStreamChunk,
        });
    } else {
      let contextText = '';
      const fragmentLabel = t('ai.prompts.context_fragment_label');
      for (const id of Array.from(selectedNodes)) {
        const el = nodesRef.current[id];
        if (el) {
          contextText += fragmentLabel + getCanvasNodeContextText(el);
        }
      }
      callAi = (onStreamChunk) =>
        callUniversalAI({
          config: aiConfig,
          systemInstruction: combineSystemParts(
            t('ai.prompts.toolbarWithNotesSystem'),
            getLocaleDirective(),
          ),
          prompt: withAttachments(
            t('ai.prompts.toolbarWithNotesUser', { context: contextText, request }),
          ),
          images,
          onStreamChunk,
        });
    }

    const { text } = await createAiCardAndStream({ node: { x, y }, callAi });
    if (text) {
      setAiPrompt('');
      clearAttachments();
    }
  };

  /** 把规划出来的节点排成网格落库。 */
  const createPlannedNodes = async (planned: PlannedCanvasNode[]) => {
    const center = getCanvasCenterPosition(transformRef.current);
    const points = layoutPlannedNodes(planned.length, center);
    await db.nodes.bulkAdd(
      planned.map((node, index) => ({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        type: node.type,
        content: node.content,
        x: points[index].x,
        y: points[index].y,
      })),
    );
  };

  /**
   * 先试着把输入当成「建节点」指令。
   * 返回 true 表示已经建完，调用方不该再走问答流程。
   */
  const tryCreateNodesFromRequest = async (request: string): Promise<boolean> => {
    if (!looksLikeCanvasNodeRequest(request)) return false;

    setIsToolbarAiLoading(true);
    try {
      const plan = await planCanvasNodes({
        text: request,
        config: aiConfig,
        t,
        images: collectAttachmentImages(attachments),
        attachmentText: attachmentContextText(),
      });
      if (plan.action !== 'create') return false;

      await createPlannedNodes(plan.nodes);
      setAiPrompt('');
      clearAttachments();
      return true;
    } catch (e) {
      // 规划这一步失败不该挡住用户：退回普通问答，真出错了那边还会再报一次
      logger.error('ai', 'canvas node planning failed', formatAiError(e));
      return false;
    } finally {
      setIsToolbarAiLoading(false);
    }
  };

  const handleAiSubmit = async () => {
    const raw = aiPrompt.trim();
    if (!raw || isPublishing || isToolbarAiLoading || isToolbarIntentPreflight || analyzingAgentNodeId !== null || followUpParentId !== null || intentClarification !== null) {
      return;
    }

    const runWithLoading = async (request: string) => {
      setIsToolbarAiLoading(true);
      try {
        await runToolbarAiGeneration(request);
      } catch (error) {
        const msg = formatAiError(error);
        logger.error('ai', 'handleAiSubmit failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
        void appAlert({
          message: formatAiFailureAlertMessage(error, t),
        });
      } finally {
        setIsToolbarAiLoading(false);
      }
    };

    // 「建三个便签…」这类指令直接落节点，不生成 AI 卡
    if (await tryCreateNodesFromRequest(raw)) return;

    if (!shouldPreflightToolbarIntent(raw)) {
      await runWithLoading(raw);
      return;
    }

    setIsToolbarIntentPreflight(true);
    let proceedWithOriginal = false;
    try {
      const analysis = await analyzeToolbarIntentPreflight(raw, aiConfig, t);
      if (analysis.ambiguous) {
        setIntentClarification({
          original: raw,
          options: analysis.options,
          hint: analysis.hint,
        });
      } else {
        proceedWithOriginal = true;
      }
    } catch (e) {
      const msg = formatAiError(e);
      logger.error('ai', 'toolbar intent preflight failed', msg);
      proceedWithOriginal = true;
    } finally {
      setIsToolbarIntentPreflight(false);
    }

    if (proceedWithOriginal) {
      await runWithLoading(raw);
    }
  };

  const cancelIntentClarification = () => setIntentClarification(null);

  const confirmIntentClarification = async (finalRequest: string) => {
    if (!intentClarification) return;
    setIntentClarification(null);
    setIsToolbarAiLoading(true);
    try {
      await runToolbarAiGeneration(finalRequest);
    } catch (error) {
      const msg = formatAiError(error);
      logger.error('ai', 'handleAiSubmit after intent clarify failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: formatAiFailureAlertMessage(error, t),
      });
    } finally {
      setIsToolbarAiLoading(false);
    }
  };

  const submitAiThreadFollowUp = async (parentNodeId: string, userMessage: string) => {
    const trimmed = userMessage.trim();
    if (!trimmed || followUpGuardRef.current) return;
    if (isPublishing || isToolbarAiLoading || analyzingAgentNodeId !== null || followUpParentId !== null) return;

    const parent = dynamicNodes.find((n) => n.id === parentNodeId);
    if (!parent || parent.type !== 'ai') return;

    const previous = (parent.content ?? '').trim();
    const searchIntent = parseThreadWebSearchIntent(trimmed);

    if (searchIntent) {
      const key = (aiConfig.searchApiKey || '').trim();
      if (!key) {
        void appAlert({ message: t('nodes.search_no_metaso_key') });
        return;
      }

      const query =
        searchIntent.explicitQuery ||
        deriveSearchQueryFromNoteText(previous.replace(/#{1,6}\s+/g, ''));
      if (!query) {
        void appAlert({ message: t('nodes.search_need_text') });
        return;
      }

      followUpGuardRef.current = true;
      setFollowUpParentId(parentNodeId);
      try {
        const res = await webSearch(query, {
          kind: aiConfig.searchProvider ?? DEFAULT_SEARCH_PROVIDER,
          apiKey: key,
        });
        const pages = res.webpages ?? [];
        if (pages.length === 0) {
          void appAlert({ message: t('nodes.search_no_results') });
          return;
        }

        const el = nodesRef.current[parentNodeId];
        const h = el?.offsetHeight ?? 200;
        const w = parent.width && parent.width > 0 ? parent.width : el?.offsetWidth ?? 320;
        const childY = parent.y + h + THREAD_GAP;
        const newNodeId = crypto.randomUUID();

        await db.nodes.add({
          id: newNodeId,
          canvasId: activeCanvasId,
          type: 'ai',
          userTurn: trimmed,
          content: t('nodes.search_follow_up_ack'),
          x: parent.x,
          y: childY,
          width: w,
          ...(parent.threadRootContextNodeId != null && parent.threadAgentConfigId != null
            ? {
                threadRootContextNodeId: parent.threadRootContextNodeId,
                threadAgentConfigId: parent.threadAgentConfigId,
                ...(parent.threadContextImageNodeIds != null
                  ? { threadContextImageNodeIds: parent.threadContextImageNodeIds }
                  : {}),
              }
            : {}),
        });
        await db.edges.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          from: parentNodeId,
          to: newNodeId,
        });
        await spawnWebSearchCardsFromPages(newNodeId, { x: parent.x, y: childY }, pages, activeCanvasId);
        await db.nodes.update(parentNodeId, { followUpSent: true });
      } catch (e) {
        const msg = formatAiError(e);
        logger.error('ai', 'thread web search failed', {
          error: msg,
        });
        void appAlert({ message: `${t('nodes.search_failed')}\n\n${resolveErrorMessage(e, t)}` });
      } finally {
        followUpGuardRef.current = false;
        setFollowUpParentId(null);
      }
      return;
    }

    followUpGuardRef.current = true;
    setFollowUpParentId(parentNodeId);
    try {
      const agentConfig =
        parent.threadAgentConfigId != null
          ? agentConfigs.find((a) => a.id === parent.threadAgentConfigId)
          : undefined;
      const chain = collectAiThreadChain(dynamicNodes, edges, parentNodeId);
      const rootMatchesThread =
        chain[0]?.threadAgentConfigId != null &&
        chain[0].threadAgentConfigId === parent.threadAgentConfigId;
      const useAgentThread =
        agentConfig != null && parent.threadAgentConfigId != null && rootMatchesThread;

      const threadImageIds =
      parent.threadContextImageNodeIds ?? chain[0]?.threadContextImageNodeIds;
      const threadImageDataUrls = resolveImageDataUrlsFromNodeIds(
        threadImageIds,
        dynamicNodes,
      );

      const el = nodesRef.current[parentNodeId];
      const h = el?.offsetHeight ?? 200;
      const w = parent.width && parent.width > 0 ? parent.width : el?.offsetWidth ?? 320;
      const threadMeta =
        parent.threadRootContextNodeId != null && parent.threadAgentConfigId != null
          ? {
              threadRootContextNodeId: parent.threadRootContextNodeId,
              threadAgentConfigId: parent.threadAgentConfigId,
              ...(parent.threadContextImageNodeIds != null
                ? { threadContextImageNodeIds: parent.threadContextImageNodeIds }
                : {}),
            }
          : {};

      const callAi = useAgentThread
        ? (onStreamChunk: (accumulated: string) => void) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: buildAgentSystemInstruction(agentConfig!, {
                fallbackPrompt: t('agents.studio.fallback_assistant'),
              }),
              prompt: t('ai.prompts.agentThreadFollowUp', {
                initialContext: (() => {
                  const ctxId = parent.threadRootContextNodeId ?? chain[0]?.threadRootContextNodeId;
                  let initialContext = t('ai.prompts.agentThreadContextMissing');
                  if (ctxId) {
                    const ctxEl = nodesRef.current[ctxId];
                    if (ctxEl) {
                      const raw = getCanvasNodeContextText(ctxEl).trim();
                      if (raw) initialContext = raw;
                    }
                  }
                  return initialContext;
                })(),
                dialogueHistory: formatAgentThreadDialogueHistory(chain),
                request: trimmed,
              }),
              temperature: agentConfig!.temperature ?? 0.7,
              topP: agentConfig!.creativity ?? 0.4,
              images: threadImageDataUrls.length > 0 ? threadImageDataUrls : undefined,
              onStreamChunk,
            })
        : (onStreamChunk: (accumulated: string) => void) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: getLocaleDirective(),
              prompt: t('ai.prompts.threadFollowUp', {
                previous: previous || '—',
                request: trimmed,
              }),
              onStreamChunk,
            });

      const { text } = await createAiCardAndStream({
        node: {
          userTurn: trimmed,
          x: parent.x,
          y: parent.y + h + THREAD_GAP,
          width: w,
          ...threadMeta,
        },
        edgeFrom: parentNodeId,
        callAi,
      });

      if (text) {
        await db.nodes.update(parentNodeId, { followUpSent: true });
      }
    } catch (e) {
      const msg = formatAiError(e);
      logger.error('ai', 'submitAiThreadFollowUp failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
      void appAlert({
        message: formatAiFailureAlertMessage(e, t),
      });
    } finally {
      followUpGuardRef.current = false;
      setFollowUpParentId(null);
      setStreamingAiNodeId(null);
    }
  };

  /**
   * 就地重跑一张 AI 卡片。
   *
   * 只有**带着来历**的卡片能重跑：知道当初是哪个人设、基于哪张便签生成的
   * （`threadAgentConfigId` + `threadRootContextNodeId`），才谈得上"用同样的方式再来一次"。
   * 工具栏随手生成的卡片没有记下提示词，重跑出来的会是另一回事，所以直接跳过而不是瞎猜。
   *
   * 内容写回**同一个节点**，不新建卡片：沿边重算的语义是"这张卡过时了，刷新它"，
   * 每重算一次多出一张卡的话，跑三轮画布上就堆了一片。
   *
   * @returns 'ok' 跑完了；'skipped' 这张卡没有来历；'failed' 调用出错
   */
  const regenerateAiNode = async (nodeId: string): Promise<'ok' | 'skipped' | 'failed'> => {
    const node = dynamicNodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'ai') return 'skipped';

    const agentConfigId = node.threadAgentConfigId;
    const contextNodeId = node.threadRootContextNodeId;
    const agentConfig = agentConfigId ? agentConfigs.find((a) => a.id === agentConfigId) : undefined;
    if (!agentConfig || !contextNodeId) return 'skipped';

    const contextEl = nodesRef.current[contextNodeId];
    const contextText = contextEl ? getCanvasNodeContextText(contextEl).trim() : '';
    if (!contextText) return 'skipped';

    const images = resolveImageDataUrlsFromNodeIds(node.threadContextImageNodeIds, dynamicNodes);
    const followUp = node.userTurn?.trim();
    // 追问卡要连着上文一起重跑，否则重跑出来的回答会脱离对话
    const chain = collectAiThreadChain(dynamicNodes, edges, nodeId);
    const history = formatAgentThreadDialogueHistory(chain.filter((c) => c.id !== nodeId));

    setStreamingAiNodeId(nodeId);
    try {
      await runCanvasStreamingAiCall({
        nodeId,
        // 重生成：失败/空结果时留住旧回答；新回答成功后旧的进 aiTurns 历史
        mode: 'regenerate',
        callAi: (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            systemInstruction: buildAgentSystemInstruction(agentConfig),
            prompt: followUp
              ? t('ai.prompts.agentThreadFollowUp', {
                  initialContext: contextText,
                  dialogueHistory: history,
                  request: followUp,
                })
              : t('ai.prompts.agentContext', { content: contextText }),
            temperature: agentConfig.temperature ?? 0.7,
            topP: agentConfig.creativity ?? 0.4,
            images: images.length > 0 ? images : undefined,
            onStreamChunk,
          }),
      });
      return 'ok';
    } catch (e) {
      logger.error('ai', 'regenerateAiNode failed', {
        error: formatAiError(e),
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
      return 'failed';
    } finally {
      setStreamingAiNodeId(null);
    }
  };

  return {
    isPublishing,
    isToolbarAiLoading,
    analyzingAgentNodeId,
    regenerateAiNode,
    followUpParentId,
    streamingAiNodeId,
    isAnyAiBusy,
    aiPrompt,
    setAiPrompt,
    handlePublish,
    triggerAgentAnalysis,
    handleAiSubmit,
    submitAiThreadFollowUp,
    intentClarification,
    isToolbarIntentPreflight,
    cancelIntentClarification,
    confirmIntentClarification,
    attachments,
    addAttachments,
    removeAttachment,
  };
}
