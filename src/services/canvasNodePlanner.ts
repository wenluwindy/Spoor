import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { extractFirstJsonObject } from '../utils/extractJsonObject';

/**
 * 把「建三个便签，分别写 A、B、C」这类自然语言变成一批待落库的节点。
 *
 * 底部输入栏原本只会生成一张 AI 卡；`+ 新建`/`角色` 两个按钮撤掉之后，
 * 建节点这件事全靠这里听懂。粗筛在 `utils/canvasNodeRequestGate`，
 * 只有粗筛放行的输入才会走到这一步。
 */

/** 规划器能建的节点类型：便签（`text`）与主题卡（`theme`），与 `CANVAS_CREATE_ITEMS` 一致。 */
export interface PlannedCanvasNode {
  type: 'text' | 'theme';
  content: string;
}

export type CanvasNodePlan =
  | { action: 'answer' }
  | { action: 'create'; nodes: PlannedCanvasNode[] };

/** 一次最多建这么多张。模型偶尔会把「几个」理解成几十个，画布会被瞬间铺满。 */
export const MAX_PLANNED_NODES = 12;

/** 单张内容长度上限，超出截断——便签不是文档，太长应该走 AI 卡。 */
export const MAX_PLANNED_NODE_CHARS = 600;

function normalizeNode(raw: unknown): PlannedCanvasNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const content = typeof o.content === 'string' ? o.content.trim() : '';
  if (!content) return null;
  return {
    type: o.type === 'theme' ? 'theme' : 'text',
    content: content.slice(0, MAX_PLANNED_NODE_CHARS),
  };
}

/** 把模型返回的任意结构收敛成一个可执行的计划；拿不出有效节点一律降级为问答。 */
export function normalizeCanvasNodePlan(parsed: unknown): CanvasNodePlan {
  if (!parsed || typeof parsed !== 'object') return { action: 'answer' };
  const o = parsed as Record<string, unknown>;
  if (o.action !== 'create' || !Array.isArray(o.nodes)) return { action: 'answer' };

  const nodes = o.nodes
    .map(normalizeNode)
    .filter((n): n is PlannedCanvasNode => n !== null)
    .slice(0, MAX_PLANNED_NODES);

  return nodes.length > 0 ? { action: 'create', nodes } : { action: 'answer' };
}

export interface PlanCanvasNodesParams {
  text: string;
  config: AIConfig;
  t: TFunction<'translation', undefined>;
  /** 输入栏附件里的图片（data URL），让「把图里的要点做成便签」也能成立。 */
  images?: string[];
  /** 输入栏附件里的文档正文，拼进用户消息。 */
  attachmentText?: string;
}

/**
 * 调一次轻量模型判断该建哪些节点。
 *
 * 调用方**不要**捕获后静默失败：解析不出结果时这里已经返回 `answer`，
 * 只有网络/鉴权异常才会抛出，那种情况应该照常报错给用户。
 */
export async function planCanvasNodes({
  text,
  config,
  t,
  images,
  attachmentText,
}: PlanCanvasNodesParams): Promise<CanvasNodePlan> {
  const raw = await callUniversalAI({
    config,
    systemInstruction: combineSystemParts(getLocaleDirective(), t('ai.node_plan.system')),
    prompt: t('ai.node_plan.user', {
      text: attachmentText ? `${attachmentText}\n\n${text}` : text,
      max: MAX_PLANNED_NODES,
    }),
    temperature: 0.2,
    topP: 0.4,
    images: images && images.length > 0 ? images : undefined,
  });

  if (!raw?.trim()) return { action: 'answer' };
  try {
    return normalizeCanvasNodePlan(extractFirstJsonObject(raw));
  } catch {
    return { action: 'answer' };
  }
}
