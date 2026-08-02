import React from 'react';
import type { AgentConfig, Canvas, CanvasNode } from '../../db';
import type { AIConfigV2 } from '../../types/aiConfig';
import { DraggableNode } from './DraggableNode';
import { NodeRenderer } from '../nodes/NodeRenderer';

/**
 * 画布单节点的 memo 边界。
 *
 * 0.3.x 全库零 React.memo：App 每次重渲（平移提交、选区变化、AI 起止）都把
 * 全部渲染中的节点树重建一遍。这里把「一张卡」收进一个 memo 组件，配一个
 * **知道节点类型**的比较器——传送门卡不关心生图集合变没变，便签不关心
 * `allNodes` 的引用换没换。于是常态下的 App 重渲在每张卡的门口就被拦住。
 *
 * 维护约定：`NodeRenderer` 若新增分支或让某类节点用上新的数据 prop，
 * 必须同步更新下面比较器里对应的类型判断，否则那类卡会"该更新时不更新"。
 */

/** 跨节点恒定的部分：refs 与 id 参数化的回调。**引用必须终身稳定**（App 用 ref 转发模式构造）。 */
export interface CanvasNodeSharedProps {
  nodesRef: React.MutableRefObject<Record<string, HTMLElement | null>>;
  /** 只读缩放（直读 transformRef，不随渲染走）：拖拽/拉伸把屏幕位移换算成画布位移用。 */
  scaleRef: { readonly current: number };
  onLink: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onDragEnd: (id: string, pos: { x: number; y: number }) => void;
  onResizeEnd: (id: string, size: { width: number; height: number }) => void;
  onStickyActivate: (id: string) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>, id: string) => void;
  onStyleChange: (id: string, patch: NonNullable<CanvasNode['styleOverrides']>) => void;
  setEditingNodeId: (id: string | null) => void;
  onAgentRunAnalysis: (id: string) => void;
  onAiFollowUp: (id: string, message: string) => void;
  onImageGenGenerate: (id: string) => void;
  onImageGenCancel: (id: string) => void;
  onImageGenPatch: (id: string, patch: Partial<CanvasNode>) => void;
  onImageGenDeleteResult: (id: string, index: number) => void;
  onImageGenSetActiveIndex: (id: string, index: number) => void;
  onOpenCanvas: (canvasId: string) => void;
  onWebFetch: (id: string, url: string) => void;
  onPdfExtract: (id: string, text: string) => void;
  onPdfPageChange: (id: string, page: number, pageCount: number) => void;
}

export interface CanvasNodeItemProps {
  node: CanvasNode;
  rotation: number;
  glassSurface: boolean;
  zIndexOverride?: number;
  isSelected: boolean;
  selectedIds?: string[];
  isConnecting: boolean;
  editingNodeId: string | null;
  analyzingAgentNodeId: string | null;
  followUpParentId?: string | null;
  streamingAiNodeId?: string | null;
  isAnyAiBusy: boolean;
  agentConfigs: AgentConfig[];
  aiConfig?: AIConfigV2;
  allNodes: CanvasNode[];
  edges: { from: string; to: string }[];
  generatingImageNodeIds?: Set<string>;
  fetchingWebNodeIds?: Set<string>;
  canvases: Canvas[];
  targetNodeCountByCanvasId: Map<string, number>;
  shared: CanvasNodeSharedProps;
}

function CanvasNodeItemInner({
  node,
  rotation,
  glassSurface,
  zIndexOverride,
  isSelected,
  selectedIds,
  isConnecting,
  editingNodeId,
  analyzingAgentNodeId,
  followUpParentId,
  streamingAiNodeId,
  isAnyAiBusy,
  agentConfigs,
  aiConfig,
  allNodes,
  edges,
  generatingImageNodeIds,
  fetchingWebNodeIds,
  canvases,
  targetNodeCountByCanvasId,
  shared,
}: CanvasNodeItemProps) {
  const isSticky = node.type === 'note' || node.type === 'text';
  return (
    <DraggableNode
      id={node.id}
      nodesRef={shared.nodesRef}
      isConnecting={isConnecting}
      onLink={shared.onLink}
      initialX={node.x}
      initialY={node.y}
      initialWidth={node.width}
      initialHeight={node.height}
      onDelete={shared.onDelete}
      scaleRef={shared.scaleRef}
      rotation={rotation}
      isSelected={isSelected}
      selectedIds={selectedIds}
      zIndexOverride={zIndexOverride}
      isEditing={editingNodeId === node.id}
      onToggleSelect={shared.onToggleSelect}
      allowPalette={true}
      onDragEnd={shared.onDragEnd}
      onResizeEnd={shared.onResizeEnd}
      glassSurface={glassSurface}
      onStickyActivate={isSticky ? shared.onStickyActivate : undefined}
      onContextMenu={shared.onContextMenu}
      styleOverrides={node.styleOverrides}
      onStyleChange={shared.onStyleChange}
      tags={node.tags}
    >
      <NodeRenderer
        node={node}
        editingNodeId={editingNodeId}
        setEditingNodeId={shared.setEditingNodeId}
        agentConfigs={agentConfigs}
        analyzingAgentNodeId={analyzingAgentNodeId}
        onAgentRunAnalysis={shared.onAgentRunAnalysis}
        isAgentAnalysisActionDisabled={isAnyAiBusy}
        onAiFollowUp={shared.onAiFollowUp}
        followUpLoadingNodeId={followUpParentId}
        streamingAiNodeId={streamingAiNodeId}
        isFollowUpGloballyDisabled={isAnyAiBusy}
        aiConfig={aiConfig}
        allNodes={allNodes}
        edges={edges}
        generatingImageNodeIds={generatingImageNodeIds}
        onImageGenGenerate={shared.onImageGenGenerate}
        onImageGenCancel={shared.onImageGenCancel}
        onImageGenPatch={shared.onImageGenPatch}
        onImageGenDeleteResult={shared.onImageGenDeleteResult}
        onImageGenSetActiveIndex={shared.onImageGenSetActiveIndex}
        canvases={canvases}
        targetNodeCountByCanvasId={targetNodeCountByCanvasId}
        onOpenCanvas={shared.onOpenCanvas}
        fetchingWebNodeIds={fetchingWebNodeIds}
        onWebFetch={shared.onWebFetch}
        onPdfExtract={shared.onPdfExtract}
        onPdfPageChange={shared.onPdfPageChange}
      />
    </DraggableNode>
  );
}

/** 两个数组浅比较（元素按 Object.is）。 */
function arrayShallowEqual(a?: readonly unknown[], b?: readonly unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * 节点行按字段浅比较。live query 每次回流都会造出全新的行对象，
 * 只按引用比会让"任何一张卡变了 → 所有卡重渲"。字段值几乎全是原始类型，
 * 逐字段 Object.is 足够便宜；数组/对象字段（tags、imageGenResults…）退化为引用比较，
 * 代价只是携带这些字段的卡在库写入后多渲一次。
 */
function nodeShallowEqual(a: CanvasNode, b: CanvasNode): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof CanvasNode)[];
  const bKeys = Object.keys(b) as (keyof CanvasNode)[];
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (Object.is(av, bv)) continue;
    // 数组/对象字段（tags、styleOverrides、imageGenResults…）每次 live query 回流
    // 都是新引用，往下钻一层再比，免得带这些字段的卡在任何写库后都白重渲
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (arrayShallowEqual(av, bv)) continue;
      return false;
    }
    if (av && bv && typeof av === 'object' && typeof bv === 'object') {
      const ao = av as Record<string, unknown>;
      const bo = bv as Record<string, unknown>;
      const ak = Object.keys(ao);
      if (ak.length !== Object.keys(bo).length) return false;
      if (ak.every((k) => Object.is(ao[k], bo[k]))) continue;
      return false;
    }
    return false;
  }
  return true;
}

/** 「某个"当前 id"是否与本节点相关」在前后两态间没变。 */
function idFlagUnchanged(nodeId: string, prev?: string | null, next?: string | null): boolean {
  return (prev === nodeId) === (next === nodeId);
}

function setFlagUnchanged(nodeId: string, prev?: Set<string>, next?: Set<string>): boolean {
  return (prev?.has(nodeId) ?? false) === (next?.has(nodeId) ?? false);
}

function areEqual(prev: CanvasNodeItemProps, next: CanvasNodeItemProps): boolean {
  if (prev.shared !== next.shared) return false;
  if (!nodeShallowEqual(prev.node, next.node)) return false;
  const id = next.node.id;
  const type = next.node.type;

  if (
    prev.rotation !== next.rotation ||
    prev.glassSurface !== next.glassSurface ||
    prev.zIndexOverride !== next.zIndexOverride ||
    prev.isSelected !== next.isSelected ||
    prev.isConnecting !== next.isConnecting ||
    prev.isAnyAiBusy !== next.isAnyAiBusy
  ) {
    return false;
  }
  if (!arrayShallowEqual(prev.selectedIds, next.selectedIds)) return false;

  // "当前编辑/分析/流式的是谁"：只有涉及本节点的变化才需要重渲
  if (!idFlagUnchanged(id, prev.editingNodeId, next.editingNodeId)) return false;
  if (!idFlagUnchanged(id, prev.analyzingAgentNodeId, next.analyzingAgentNodeId)) return false;
  if (!idFlagUnchanged(id, prev.followUpParentId, next.followUpParentId)) return false;
  if (!idFlagUnchanged(id, prev.streamingAiNodeId, next.streamingAiNodeId)) return false;
  if (!setFlagUnchanged(id, prev.generatingImageNodeIds, next.generatingImageNodeIds)) return false;
  if (!setFlagUnchanged(id, prev.fetchingWebNodeIds, next.fetchingWebNodeIds)) return false;

  // 数据 prop 按"哪类节点真的读它"过滤（与 NodeRenderer 的分支一一对应）
  if (type === 'imagegen') {
    if (prev.aiConfig !== next.aiConfig) return false;
    if (prev.allNodes !== next.allNodes) return false;
    if (prev.edges !== next.edges) return false;
  }
  if (type === 'canvasLink') {
    if (prev.canvases !== next.canvases) return false;
    if (prev.targetNodeCountByCanvasId !== next.targetNodeCountByCanvasId) return false;
  }
  if (type === 'agent') {
    if (prev.agentConfigs !== next.agentConfigs) return false;
  }
  return true;
}

export const CanvasNodeItem = React.memo(CanvasNodeItemInner, areEqual);
