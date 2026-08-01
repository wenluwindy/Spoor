/**
 * 把一次研究落到画布上。
 *
 * 研究结果原先只沉淀成一篇长文——读得了，但接不上后续思考。落到画布上之后，
 * 每个论点都是一张能连线、能追问、能被 AI 重新分析的卡片，而一个区域框把它们
 * 圈在一起，不至于把已有的画布冲散。
 *
 * 布局是**确定性**的：题目在最上，计划一列，论点一列，结论在最后，全部连回题目卡。
 * 不做自动排布算法——研究报告的结构本来就是线性的，硬套力导向图只会让人找不到北。
 */

import type { CanvasNode, Edge, ResearchSession } from '../db';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH } from './canvasFrame';

/** 卡片宽度与列间距。 */
const CARD_WIDTH = 300;
const COLUMN_GAP = 360;
const ROW_GAP = 200;
/** 框比内容四周各留这么多。 */
const FRAME_PADDING = 60;

export interface ResearchFrameLayout {
  nodes: CanvasNode[];
  edges: Edge[];
}

export interface BuildResearchFrameOptions {
  canvasId: string;
  /** 落点（框的左上角）。 */
  at: { x: number; y: number };
  session: Pick<ResearchSession, 'query' | 'researchPlan' | 'researchReport'>;
  /** 区域框的标题，通常是「研究：<题目>」。 */
  frameLabel: string;
  /** 计划列与论点列的表头文案。 */
  planLabel: string;
  conclusionLabel: string;
  newId?: () => string;
}

/**
 * 生成一整块研究区域：一个框 + 题目卡 + 计划卡若干 + 论点卡若干 + 结论卡，
 * 计划与论点都连回题目卡，结论连回题目卡。
 */
export function buildResearchFrame({
  canvasId,
  at,
  session,
  frameLabel,
  planLabel,
  conclusionLabel,
  newId = () => crypto.randomUUID(),
}: BuildResearchFrameOptions): ResearchFrameLayout {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];

  const innerX = at.x + FRAME_PADDING;
  const innerY = at.y + FRAME_PADDING;

  // 题目卡：整块的锚点
  const topicId = newId();
  nodes.push({
    id: topicId,
    canvasId,
    type: 'theme',
    content: session.query,
    description: session.researchReport.intro,
    x: innerX,
    y: innerY,
    width: CARD_WIDTH,
  });

  const plan = session.researchPlan ?? [];
  plan.forEach((step, index) => {
    const id = newId();
    nodes.push({
      id,
      canvasId,
      type: 'text',
      content: `**${planLabel} ${index + 1} · ${step.title}**\n\n${step.desc}`,
      x: innerX + COLUMN_GAP,
      y: innerY + index * ROW_GAP,
      width: CARD_WIDTH,
    });
    edges.push({ id: newId(), canvasId, from: topicId, to: id });
  });

  const points = session.researchReport.points ?? [];
  points.forEach((point, index) => {
    const id = newId();
    nodes.push({
      id,
      canvasId,
      type: 'text',
      content: `**${point.title}**\n\n${point.text}`,
      x: innerX + COLUMN_GAP * 2,
      y: innerY + index * ROW_GAP,
      width: CARD_WIDTH,
    });
    edges.push({ id: newId(), canvasId, from: topicId, to: id });
  });

  const conclusion = session.researchReport.conclusion?.trim();
  if (conclusion) {
    const id = newId();
    nodes.push({
      id,
      canvasId,
      type: 'text',
      content: `**${conclusionLabel}**\n\n${conclusion}`,
      x: innerX + COLUMN_GAP * 3,
      y: innerY,
      width: CARD_WIDTH,
    });
    edges.push({ id: newId(), canvasId, from: topicId, to: id });
  }

  // 框最后算：要把上面所有卡片都包进去
  const right = Math.max(...nodes.map((n) => n.x + (n.width ?? CARD_WIDTH)));
  const bottom = Math.max(...nodes.map((n) => n.y + ROW_GAP - 40));
  const frame: CanvasNode = {
    id: newId(),
    canvasId,
    type: 'frame',
    content: frameLabel,
    x: at.x,
    y: at.y,
    width: Math.max(right - at.x + FRAME_PADDING, DEFAULT_FRAME_WIDTH),
    height: Math.max(bottom - at.y + FRAME_PADDING, DEFAULT_FRAME_HEIGHT),
  };

  // 框排在最前：数组顺序即 z 序，框必须在卡片下面
  return { nodes: [frame, ...nodes], edges };
}
