import React from 'react';
import type { AgentConfig, Canvas, CanvasNode } from '../../db';
import { ThemeNode } from './ThemeNode';
import { NoteNode } from './NoteNode';
import { AiNode } from './AiNode';
import { ImageNode } from './ImageNode';
import { VideoNode } from './VideoNode';
import { DocumentNode } from './DocumentNode';
import { AgentNode } from './AgentNode';
import { ImageGenNode } from './ImageGenNode';
import { CanvasLinkNode } from './CanvasLinkNode';
import type { AIConfigV2 } from '../../types/aiConfig';

/** 画布对某些 `type` 挂载的控件与各分支对应关系见 `src/constants/nodeCapabilities.ts`。 */
interface NodeRendererProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  agentConfigs: AgentConfig[];
  analyzingAgentNodeId: string | null;
  /** Invoked when user clicks Run analysis on an agent card (linked notes only). */
  onAgentRunAnalysis?: (agentNodeId: string) => void;
  isAgentAnalysisActionDisabled?: boolean;
  onAiFollowUp?: (nodeId: string, message: string) => void;
  followUpLoadingNodeId?: string | null;
  streamingAiNodeId?: string | null;
  isFollowUpGloballyDisabled?: boolean;
  /** 生图节点需要读配置与同画布的连线，才能解析参考图与上游文本。 */
  aiConfig?: AIConfigV2;
  allNodes?: CanvasNode[];
  edges?: { from: string; to: string }[];
  generatingImageNodeIds?: Set<string>;
  onImageGenGenerate?: (nodeId: string) => void;
  onImageGenCancel?: (nodeId: string) => void;
  onImageGenPatch?: (nodeId: string, patch: Partial<CanvasNode>) => void;
  onImageGenDeleteResult?: (nodeId: string, index: number) => void;
  onImageGenSetActiveIndex?: (nodeId: string, index: number) => void;
  /** 传送门卡片要按 id 查目标画布的名字与规模。 */
  canvases?: Canvas[];
  targetNodeCountByCanvasId?: Map<string, number>;
  onOpenCanvas?: (canvasId: string) => void;
}

export function NodeRenderer({
  node,
  editingNodeId,
  setEditingNodeId,
  agentConfigs,
  analyzingAgentNodeId,
  onAgentRunAnalysis,
  isAgentAnalysisActionDisabled,
  onAiFollowUp,
  followUpLoadingNodeId,
  streamingAiNodeId,
  isFollowUpGloballyDisabled,
  aiConfig,
  allNodes,
  edges,
  generatingImageNodeIds,
  onImageGenGenerate,
  onImageGenCancel,
  onImageGenPatch,
  onImageGenDeleteResult,
  onImageGenSetActiveIndex,
  canvases,
  targetNodeCountByCanvasId,
  onOpenCanvas,
}: NodeRendererProps) {
  switch (node.type) {
    case 'theme':
      return <ThemeNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'note':
    case 'text':
      return (
        <NoteNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
        />
      );
    case 'ai':
      return (
        <AiNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onSubmitFollowUp={onAiFollowUp ? (msg) => onAiFollowUp(node.id, msg) : undefined}
          isFollowUpLoading={followUpLoadingNodeId === node.id}
          isContentStreaming={streamingAiNodeId === node.id}
          isFollowUpDisabled={isFollowUpGloballyDisabled}
        />
      );
    case 'image':
      return <ImageNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'video':
      return <VideoNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'document':
      return <DocumentNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'imagegen':
      // 配置/连线没传进来说明调用方还没接生图（比如某些独立渲染场景），不渲染比崩掉好
      if (!aiConfig) return null;
      return (
        <ImageGenNode
          node={node}
          aiConfig={aiConfig}
          nodes={allNodes ?? []}
          edges={edges ?? []}
          isGenerating={generatingImageNodeIds?.has(node.id) ?? false}
          onGenerate={() => onImageGenGenerate?.(node.id)}
          onCancel={() => onImageGenCancel?.(node.id)}
          onPatch={(patch) => onImageGenPatch?.(node.id, patch)}
          onDeleteResult={(index) => onImageGenDeleteResult?.(node.id, index)}
          onSetActiveIndex={(index) => onImageGenSetActiveIndex?.(node.id, index)}
        />
      );
    case 'canvasLink':
      return (
        <CanvasLinkNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          canvases={canvases ?? []}
          targetNodeCount={
            node.targetCanvasId ? targetNodeCountByCanvasId?.get(node.targetCanvasId) : undefined
          }
          onOpen={onOpenCanvas}
        />
      );
    case 'agent':
      return (
        <AgentNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          agentConfigs={agentConfigs}
          isAnalyzing={analyzingAgentNodeId === node.id}
          onRunAnalysis={onAgentRunAnalysis ? () => onAgentRunAnalysis(node.id) : undefined}
          isAgentAnalysisActionDisabled={isAgentAnalysisActionDisabled}
        />
      );
    default:
      return null;
  }
}
