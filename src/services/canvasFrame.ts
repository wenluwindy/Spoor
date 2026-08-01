/**
 * 区域框（Frame）。
 *
 * 一个带标题的矩形，画在别的卡片**后面**。拖动它时，框住的卡片跟着一起走。
 *
 * 成员关系**按几何判定**，不存 parentId：画布上"在不在框里"本来就是看出来的，
 * 让数据跟着眼睛走比让眼睛跟着数据走可靠得多。存一份成员表意味着移动、删除、撤销、
 * 导入都要维护它的一致性，而任何一处漏掉都会变成"看着在框里、拖动却不跟着走"
 * 这类没法解释的 bug。
 *
 * 代价是每次渲染要算一遍框内有谁。节点数在几百这个量级，一次线性扫描不值得优化。
 */

import type { CanvasNode } from '../db';

/** 节点没写宽高时按这个估算中心点。与新建卡片的默认宽度一致。 */
export const ASSUMED_NODE_WIDTH = 320;
export const ASSUMED_NODE_HEIGHT = 160;

/** 新建区域框的默认大小：装得下两三张卡片。 */
export const DEFAULT_FRAME_WIDTH = 760;
export const DEFAULT_FRAME_HEIGHT = 520;

export function isFrame(node: CanvasNode | undefined): boolean {
  return node?.type === 'frame';
}

function centerOf(node: CanvasNode): { x: number; y: number } {
  return {
    x: node.x + (node.width ?? ASSUMED_NODE_WIDTH) / 2,
    y: node.y + (node.height || ASSUMED_NODE_HEIGHT) / 2,
  };
}

/**
 * 框住了哪些节点。
 *
 * 用**中心点**判定而不是完全包含：一张卡片探出去半个身位仍然算在框里，
 * 这与人看画布时的判断一致。别的框不算成员——嵌套框会让"拖谁动谁"变得没法预期。
 */
export function nodesInsideFrame(frame: CanvasNode, nodes: CanvasNode[]): string[] {
  const left = frame.x;
  const top = frame.y;
  const right = frame.x + (frame.width ?? DEFAULT_FRAME_WIDTH);
  const bottom = frame.y + (frame.height || DEFAULT_FRAME_HEIGHT);

  return nodes
    .filter((node) => {
      if (node.id === frame.id || node.type === 'frame') return false;
      const center = centerOf(node);
      return center.x >= left && center.x <= right && center.y >= top && center.y <= bottom;
    })
    .map((node) => node.id);
}

/**
 * 拖动这个节点时应该带着谁一起走。
 *
 * 区域框带着框里的卡片；普通节点带着同选区里的其它卡片。两者不叠加——
 * 拖框就是拖框，不该顺带把画布另一头选中的卡片也拽过来。
 */
export function groupIdsForDrag(
  node: CanvasNode,
  nodes: CanvasNode[],
  selectedIds: string[],
): string[] {
  if (isFrame(node)) {
    const members = nodesInsideFrame(node, nodes);
    return members.length > 0 ? [node.id, ...members] : [];
  }
  return selectedIds;
}
