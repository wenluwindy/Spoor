/**
 * 把研究执行中的**单个已完成步骤**落到画布上。
 *
 * 整份报告的落卡（`researchToCanvas.buildResearchFrame`）要等研究全部跑完；
 * 但一次分步研究往往在第二三步就已经出现值得留下的判断。这里允许用户在
 * 执行视图里对任何一个已完成的步骤按下「落到画布」：该步的分析成为一张
 * 主题卡（标题=步骤标题，正文=该步分析全文），带链接的来源各落一张 web 卡
 * （形态与 `spawnWebSearchNoteCards` 一致：标题/摘要来自搜索快照，地址可重抓），
 * 全部连回主题卡。
 *
 * 布局是**确定性**的：主题卡在落点，来源卡在右侧一列列排开（每列三张）。
 * 本模块是纯函数——不碰 React、不碰 IndexedDB，落库与撤销由调用方通过
 * `canvasMutations.addNodesAndEdgesRecorded` 一步完成。
 */

import type { CanvasNode, Edge } from '../db';
import { hostLabel } from './webPage';

/** 主题卡宽度，与 `researchToCanvas` 的卡宽一致。 */
const THEME_CARD_WIDTH = 300;
/** web 卡宽度，与 `spawnWebSearchNoteCards` 落的 web 卡一致。 */
const WEB_CARD_WIDTH = 320;
/** 主题卡到来源列的水平距离。 */
const COLUMN_GAP = 380;
/** 来源列内的行距。 */
const ROW_GAP = 170;
/** 每列放几张来源卡。 */
const SOURCES_PER_COLUMN = 3;
/** 来源列之间的水平间距。 */
const SOURCE_COLUMN_STEP = WEB_CARD_WIDTH + 40;

export interface ResearchStepSnapshot {
  /** 步骤标题（主题卡正标题）。 */
  title: string;
  /** 该步分析全文（主题卡描述）。 */
  analysis: string;
  /** 该步检索到的来源快照；只有带 http(s) 链接的会落卡。 */
  sources: { title: string; link: string; snippet: string }[];
}

export interface BuildResearchStepCardsOptions {
  canvasId: string;
  /** 落点（主题卡左上角），通常取当前画布视口中心。 */
  at: { x: number; y: number };
  step: ResearchStepSnapshot;
  newId?: () => string;
}

export interface ResearchStepCardsLayout {
  nodes: CanvasNode[];
  edges: Edge[];
}

/**
 * 生成一个步骤的落卡布局：一张主题卡 + 带链接来源各一张 web 卡，全部连回主题卡。
 * 返回的行都已带好 `id` 与 `canvasId`，可直接交给 `addNodesAndEdgesRecorded`。
 */
export function buildResearchStepCards({
  canvasId,
  at,
  step,
  newId = () => crypto.randomUUID(),
}: BuildResearchStepCardsOptions): ResearchStepCardsLayout {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];

  const themeId = newId();
  nodes.push({
    id: themeId,
    canvasId,
    type: 'theme',
    content: step.title,
    description: step.analysis,
    x: at.x,
    y: at.y,
    width: THEME_CARD_WIDTH,
  });

  // 只落有真实链接的来源：web 卡的价值就在「地址还在、随时可重抓」，
  // 没有链接的快照落出来只是一张残缺的卡。
  const linked = step.sources.filter((s) => /^https?:\/\//i.test((s.link ?? '').trim()));
  linked.forEach((wp, index) => {
    const id = newId();
    const column = Math.floor(index / SOURCES_PER_COLUMN);
    const row = index % SOURCES_PER_COLUMN;
    const link = wp.link.trim();
    nodes.push({
      id,
      canvasId,
      type: 'web',
      url: link,
      urlTitle: (wp.title ?? '').replace(/\n/g, ' ').trim() || undefined,
      urlExcerpt: (wp.snippet ?? '').trim() || undefined,
      urlSiteName: hostLabel(link),
      x: at.x + COLUMN_GAP + column * SOURCE_COLUMN_STEP,
      y: at.y + row * ROW_GAP,
      width: WEB_CARD_WIDTH,
    });
    edges.push({ id: newId(), canvasId, from: themeId, to: id });
  });

  return { nodes, edges };
}
