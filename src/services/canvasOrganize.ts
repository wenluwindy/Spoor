/**
 * AI 整理画布（0.5.0 C8）：把选中的散卡聚类成几个带标题的区域框。
 *
 * 流程分四段，各管各的：
 * 1. `buildOrganizeCardList` —— 给模型看的卡片清单（id + 截断摘要）；
 * 2. `parseOrganizeResponse` —— 容错解析模型的 JSON（剥代码栅栏、滤幻觉 id、去重）；
 * 3. `planOrganizeLayout` —— **纯几何**：每组一个区域框 + 组内网格排位，返回完整预览计划；
 * 4. `applyOrganizePlanRecorded` —— 预览确认后一次事务落库，**整体一步撤销**。
 *
 * AI 只决定"谁和谁一组、组叫什么"；坐标永远是本地算的——模型给的数字坐标
 * 既不可靠也不可解释，几何是确定性代码的地盘。
 */

import { db, type CanvasNode } from '../db';
import { recordCanvasHistory } from './canvasHistory';

/** 布局用的估算尺寸，与 viewportCulling/canvasFrame 的假设一致。 */
const ASSUMED_WIDTH = 320;
const ASSUMED_HEIGHT = 200;
const GRID_GAP = 32;
const FRAME_PADDING = 48;
/** 区域框标题占的头部高度。 */
const FRAME_HEADER = 56;
/** 组与组横向间距。 */
const GROUP_GAP = 80;
/** 每组每行放几张卡。 */
const COLUMNS = 3;
/** 摘要截断：模型只需要"这张卡讲什么"，不需要全文。 */
const SUMMARY_MAX = 200;

export interface OrganizeGroup {
  title: string;
  nodeIds: string[];
}

export interface OrganizeMove {
  id: string;
  before: { x: number; y: number };
  after: { x: number; y: number };
}

export interface OrganizePlan {
  canvasId: string;
  groups: OrganizeGroup[];
  /** 预览虚影与落库共用：新建的区域框行（已带 id/canvasId/坐标）。 */
  frames: CanvasNode[];
  moves: OrganizeMove[];
}

export function buildOrganizeCardList(nodes: CanvasNode[], contextTextOf: (node: CanvasNode) => string): string {
  return nodes
    .map((n) => {
      const text = contextTextOf(n).replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
      return `- id: ${n.id}\n  内容: ${text || '(空)'}`;
    })
    .join('\n');
}

/**
 * 解析模型返回。模型再怎么被要求"只输出 JSON"也会时不时裹一层代码栅栏或加一句
 * 客套话，这里按"找到第一个 { 到最后一个 }"截取后解析。
 * 幻觉 id 滤掉；一张卡出现在多组时**第一组**赢；全滤完的空组丢弃。
 */
export function parseOrganizeResponse(text: string, validIds: Set<string>): OrganizeGroup[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const rawGroups = (parsed as { groups?: unknown }).groups;
  if (!Array.isArray(rawGroups)) return null;

  const seen = new Set<string>();
  const groups: OrganizeGroup[] = [];
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.title !== 'string' || !Array.isArray(rec.nodeIds)) continue;
    const nodeIds = rec.nodeIds
      .filter((id): id is string => typeof id === 'string' && validIds.has(id) && !seen.has(id));
    nodeIds.forEach((id) => seen.add(id));
    if (nodeIds.length > 0) groups.push({ title: rec.title.trim() || '·', nodeIds });
  }
  return groups.length > 0 ? groups : null;
}

/**
 * 布局：组从选区包围盒左上角起横向排开，组内卡片按 3 列网格。
 * 列宽/行高用组内实际最大尺寸（缺省用估算值），框的外沿包住网格再加内边距。
 */
export function planOrganizeLayout(
  canvasId: string,
  groups: OrganizeGroup[],
  nodes: CanvasNode[],
  newId: () => string = () => crypto.randomUUID(),
): OrganizePlan {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const originX = Math.min(...nodes.map((n) => n.x));
  const originY = Math.min(...nodes.map((n) => n.y));

  const frames: CanvasNode[] = [];
  const moves: OrganizeMove[] = [];
  let cursorX = originX;

  for (const group of groups) {
    const members = group.nodeIds
      .map((id) => byId.get(id))
      .filter((n): n is CanvasNode => Boolean(n));
    if (members.length === 0) continue;

    const cellW = Math.max(...members.map((n) => n.width ?? ASSUMED_WIDTH), ASSUMED_WIDTH);
    const cellH = Math.max(...members.map((n) => n.height || ASSUMED_HEIGHT), ASSUMED_HEIGHT);
    const cols = Math.min(COLUMNS, members.length);
    const rows = Math.ceil(members.length / cols);

    const innerX = cursorX + FRAME_PADDING;
    const innerY = originY + FRAME_HEADER + FRAME_PADDING;
    members.forEach((member, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const after = {
        x: innerX + col * (cellW + GRID_GAP),
        y: innerY + row * (cellH + GRID_GAP),
      };
      if (after.x !== member.x || after.y !== member.y) {
        moves.push({ id: member.id, before: { x: member.x, y: member.y }, after });
      }
    });

    const frameW = cols * cellW + (cols - 1) * GRID_GAP + FRAME_PADDING * 2;
    const frameH = rows * cellH + (rows - 1) * GRID_GAP + FRAME_PADDING * 2 + FRAME_HEADER;
    frames.push({
      id: newId(),
      canvasId,
      type: 'frame',
      content: group.title,
      x: cursorX,
      y: originY,
      width: frameW,
      height: frameH,
    });
    cursorX += frameW + GROUP_GAP;
  }

  return { canvasId, groups, frames, moves };
}

/**
 * 确认后落库：框与位移在同一事务里写、并成**一条**撤销记录。
 * 分两次 Recorded 调用会记成两步——用户按一次 Ctrl+Z 只回来一半，那不是"取消整理"。
 */
export async function applyOrganizePlanRecorded(plan: OrganizePlan): Promise<void> {
  await db.transaction('rw', db.nodes, async () => {
    if (plan.frames.length > 0) await db.nodes.bulkAdd(plan.frames);
    for (const move of plan.moves) {
      await db.nodes.update(move.id, { x: move.after.x, y: move.after.y });
    }
  });
  recordCanvasHistory(plan.canvasId, {
    addedNodes: plan.frames,
    updatedNodes: plan.moves.map((m) => ({ id: m.id, before: m.before, after: m.after })),
  });
}
