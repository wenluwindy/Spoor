import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type CanvasNode } from './db';
import {
  Maximize2,
  Minimize2,
  Loader2,
  PenLine,
} from 'lucide-react';
import { commitCanvasInlineEditing } from './utils/commitCanvasInlineEditing';
import { registerCanvasUnloadFlush } from './utils/registerCanvasUnloadFlush';
import { getCanvasNodeContextText } from './utils/canvasNodeContextText';
import { screenToCanvasPosition } from './utils/canvas';
import { nodeSupportsCycleLayout } from './constants/nodeCapabilities';
import { CanvasEdgeLines } from './components/canvas/CanvasEdgeLines';
import { DraggableNode } from './components/canvas/DraggableNode';
import { CanvasContextMenu, type CanvasContextMenuActions } from './components/canvas/CanvasContextMenu';
import { AISettingsModal } from './components/AISettingsModal';
import { Sidebar } from './components/Sidebar';
import { CanvasHistoryPopover } from './components/CanvasHistoryPopover';
import { CanvasToolbar } from './components/CanvasToolbar';
import { OnboardingCard } from './components/OnboardingCard';
import { Tooltip } from './components/ui/Tooltip';
import type { AIConfig } from './components/AISettingsModal';
import { Reference } from './components/Reference';
import { ResearchLab } from './components/ResearchLab';
import { AgentsStudio } from './components/AgentsStudio';
import { callUniversalAI } from './services/ai';
import { MIMO_TOKEN_PLAN_BASE_URL } from './constants/mimo';
import { DOUBAO_ARK_BASE_URL, DOUBAO_DEFAULT_MODEL } from './constants/doubao';
import { NodeRenderer } from './components/nodes/NodeRenderer';
import { useSeedData } from './hooks/useSeedData';
import { useUserProfile } from './hooks/useUserProfile';
import { useFullscreen } from './hooks/useFullscreen';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import { useCanvasMarquee } from './hooks/useCanvasMarquee';
import { computeFitTransform, unionNodeBoundsInCanvasSpace } from './utils/zoomToFit';
import { useNodeActions } from './hooks/useNodeActions';
import { pickFiles } from './utils/filePicker';
import { useAiActions } from './hooks/useAiActions';
import { useAppDialog } from './components/AppDialogProvider';
import { dataTransferHasFiles, preventDefaultIfFileDrag } from './utils/dnd';
import {
  buildStickyClipboardPayload,
  isTextEditingTarget,
  parseStickyClipboardPayload,
  stickyPastePosition,
} from './utils/noteClipboard';
/** 控制台执行 localStorage.setItem('SCRIBE_DEBUG_DND','1') 并刷新；桌面打包版也可用（不设 DEV 门槛）。 */
const DEBUG_DND =
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('SCRIBE_DEBUG_DND') === '1';

/**
 * 已存配置的兜底修正。
 *
 * tp- Token 套餐密钥须走 token-plan-cn，旧版默认 api.xiaomimimo.com 会 401；
 * 豆包缺 Base URL 时补上方舟地址。模型名一律不代填——内置 Key 移除后没有任何
 * 对所有账号都有效的默认值（豆包尤其如此，见 constants/doubao.ts）。
 */
function migrateStoredAiConfig(raw: unknown): AIConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as AIConfig;
  if (p.provider === 'mimo') {
    const b = (p.baseUrl ?? '').trim();
    if (!b || /api\.xiaomimimo\.com/i.test(b)) {
      return { ...p, baseUrl: MIMO_TOKEN_PLAN_BASE_URL };
    }
  }
  if (p.provider === 'doubao' && !(p.baseUrl ?? '').trim()) {
    return { ...p, baseUrl: DOUBAO_ARK_BASE_URL };
  }
  return p;
}
export default function App() {
  const { t, i18n } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const edgeLabelsRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);

  // Local-only UI states
  const [activeCanvasId, setActiveCanvasId] = useState<string>(() => localStorage.getItem('active_canvas_id') || 'default');

  // Database-backed states
  const articles = useLiveQuery(() => db.articles.toArray()) || [];
  const agentConfigs = useLiveQuery(() => db.agents.toArray()) || [];
  const dynamicNodes = useLiveQuery(() => 
    db.nodes.filter(node => (node.canvasId === activeCanvasId) || (!node.canvasId && activeCanvasId === 'default')).toArray()
  , [activeCanvasId]) || [];
  const edges = useLiveQuery(() => 
    db.edges.filter(edge => (edge.canvasId === activeCanvasId) || (!edge.canvasId && activeCanvasId === 'default')).toArray()
  , [activeCanvasId]) || [];
  const canvases = useLiveQuery(() => db.canvases.toArray()) || [];

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [activeReferenceId, setActiveReferenceId] = useState<string>('');
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('personal');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  /** 引导卡只在本次会话内可关掉；下次启动若仍未配置会再提示。 */
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);

  // User Profile
  const { userName, setUserName, userRole, setUserRole, userAvatar, setUserAvatar } = useUserProfile();

  // Fullscreen
  const { isFullscreen, toggleFullscreen } = useFullscreen(mainRef);

  // Canvas interaction (transform, pan, zoom, edge lines)
  const { canvasTransform, setCanvasTransform, transformRef, handlePanStart } = useCanvasInteraction(
    mainRef, contentContainerRef, svgRef, edgeLabelsRef, nodesRef, connectingFrom, setConnectingFrom,
  );

  // 左键框选（中键平移由 useCanvasInteraction 负责）
  const { marquee, handleMarqueeStart } = useCanvasMarquee({ mainRef, nodesRef, setSelectedNodes });

  /**
   * 画布背景按下：先把正在编辑的节点存盘，再按键位分派。
   * 左键 → 框选；中键 → 平移；右键交给 onContextMenu，不在这里处理。
   */
  const handleCanvasBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const nodeRow = editingNodeId ? dynamicNodes.find((n) => n.id === editingNodeId) : undefined;
      commitCanvasInlineEditing({
        editingNodeId,
        nodesRef,
        nodeType: nodeRow?.type,
      });
      if (e.button === 1) handlePanStart(e);
      else if (e.button === 0) handleMarqueeStart(e);
    },
    [editingNodeId, dynamicNodes, handlePanStart, handleMarqueeStart],
  );

  /** 缩放至适应全部内容：把所有节点的包围盒装进视口。 */
  const handleZoomToFit = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const containerRect = main.getBoundingClientRect();
    const bounds = unionNodeBoundsInCanvasSpace(
      Object.values(nodesRef.current),
      containerRect,
      transformRef.current ?? { x: 0, y: 0, scale: 1 },
    );
    if (!bounds) return;
    setCanvasTransform(
      computeFitTransform(bounds, { width: containerRect.width, height: containerRect.height }),
    );
  }, [transformRef, setCanvasTransform]);

  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('ai_config');
    const parsed = saved ? migrateStoredAiConfig(JSON.parse(saved)) : null;
    // 首次启动：给一个空壳（豆包 + 方舟地址），Key 与模型留空等用户填，见首启引导卡。
    return (
      parsed ?? {
        provider: 'doubao',
        apiKey: '',
        baseUrl: DOUBAO_ARK_BASE_URL,
        model: DOUBAO_DEFAULT_MODEL,
      }
    );
  });

  /** 未配置任何 API Key（本地 GGUF 只要有模型路径即算已配置）。 */
  const isAiUnconfigured =
    aiConfig.provider === 'local_llama'
      ? !(aiConfig.localGgufPath ?? '').trim()
      : !(aiConfig.apiKey ?? '').trim();

  useEffect(() => {
    localStorage.setItem('ai_config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  useEffect(() => {
    localStorage.setItem('active_canvas_id', activeCanvasId);
  }, [activeCanvasId]);

  useEffect(() => {
    if (articles.length === 0) {
      if (activeReferenceId !== '') setActiveReferenceId('');
      return;
    }
    if (!articles.some((a) => a.id === activeReferenceId)) {
      setActiveReferenceId(articles[0].id);
    }
  }, [articles, activeReferenceId, setActiveReferenceId]);

  useSeedData();

  useEffect(() => registerCanvasUnloadFlush(), []);

  const lastStickyClickIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastStickyClickIdRef.current = null;
  }, [activeCanvasId, activeTab]);

  const stickyClipboardRef = useRef({
    dynamicNodes,
    activeCanvasId,
  });
  stickyClipboardRef.current = { dynamicNodes, activeCanvasId };

  useEffect(() => {
    if (activeTab !== 'personal') return;

    const onCopy = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const { dynamicNodes: nodes } = stickyClipboardRef.current;
      const focusId = lastStickyClickIdRef.current;
      if (!focusId) return;
      const picked = nodes.filter((n) => n.id === focusId && (n.type === 'note' || n.type === 'text'));
      const payload = buildStickyClipboardPayload(picked);
      if (!payload) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', JSON.stringify(payload));
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parseStickyClipboardPayload(text);
      if (!payload) return;
      e.preventDefault();
      const { activeCanvasId: canvasId } = stickyClipboardRef.current;
      void (async () => {
        const rows: CanvasNode[] = payload.nodes.map((item) => {
          const id = crypto.randomUUID();
          const { x, y } = stickyPastePosition(item);
          return {
            id,
            canvasId,
            type: item.type,
            content: item.content ?? '',
            layout: item.layout,
            width: item.width,
            height: item.height,
            x,
            y,
          };
        });
        await db.nodes.bulkAdd(rows);
      })();
    };

    window.addEventListener('copy', onCopy, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [activeTab]);

  /**
   * 捕获阶段放行文件拖放：子元素（连线粗命中区、video/img 等）若未调用 dragover.preventDefault，
   * 浏览器会禁止放置；在 main 上捕获可先放行整张画布。
   * Manual QA：Chrome vs Tauri；空白区 vs 连线附近 vs 节点上；参见 localStorage SCRIBE_DEBUG_DND='1'。
   */
  useLayoutEffect(() => {
    if (activeTab !== 'personal') return;
    const el = mainRef.current;
    if (!el) return;

    const handleCaptureDragEnter = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
      if (!DEBUG_DND || !dataTransferHasFiles(e.dataTransfer)) return;
      const t = e.target;
      const tag = t instanceof Element ? t.tagName : String(t);
      console.debug('[dnd:dragenter]', {
        tag,
        types: e.dataTransfer ? Array.from(e.dataTransfer.types) : [],
      });
    };

    const handleCaptureDragOver = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
    };

    el.addEventListener('dragenter', handleCaptureDragEnter, true);
    el.addEventListener('dragover', handleCaptureDragOver, true);
    return () => {
      el.removeEventListener('dragenter', handleCaptureDragEnter, true);
      el.removeEventListener('dragover', handleCaptureDragOver, true);
    };
  }, [activeTab]);

  // Node actions (CRUD, selection, linking)
  const {
    toggleNodeSelection, handleLink, deleteEdge, removeNodeId,
    createNodeAt, addAgentNodeAt, insertFilesAt, insertPathsAt, duplicateNode, cycleNodeLayout, pasteStickyAt,
    clearSelection, deleteNodes, linkNodesToHub,
  } = useNodeActions({
    activeCanvasId, nodesRef, connectingFrom, setConnectingFrom, edges, selectedNodes, setSelectedNodes, transformRef,
  });

  // Right-click menu (canvas / node / nodes / edge)
  const { menu: contextMenu, openContextMenu, closeContextMenu } = useCanvasContextMenu(mainRef, transformRef);

  const nodesById = React.useMemo(
    () => new Map(dynamicNodes.map((n) => [n.id, n])),
    [dynamicNodes],
  );

  /** 右键落在已多选的成员上时走批量菜单；否则按单节点处理且不清空既有选中。 */
  const openNodeContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (selectedNodes.size >= 2 && selectedNodes.has(nodeId)) {
        openContextMenu(e, { kind: 'nodes', nodeIds: [...selectedNodes], anchorId: nodeId });
      } else {
        openContextMenu(e, { kind: 'node', nodeId });
      }
    },
    [openContextMenu, selectedNodes],
  );

  // AI actions (publish, agent analysis, AI submit)
  const {
    isPublishing,
    isToolbarAiLoading,
    isToolbarIntentPreflight,
    analyzingAgentNodeId,
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
    cancelIntentClarification,
    confirmIntentClarification,
    attachments,
    addAttachments,
    removeAttachment,
  } = useAiActions({
    aiConfig, agentConfigs, activeCanvasId, nodesRef, transformRef,
    dynamicNodes, edges, selectedNodes, setSelectedNodes, setActiveReferenceId, setActiveTab,
  });

  const contextMenuActions = React.useMemo<CanvasContextMenuActions>(
    () => ({
      createNode: (nodeType, at) => void createNodeAt(nodeType, at),
      insertFile: (accept, at) =>
        void pickFiles(accept).then((picked) =>
          // 桌面端拿到的是绝对路径（文件不进 JS），浏览器调试才是 File 对象
          picked.kind === 'paths'
            ? insertPathsAt(picked.paths, at)
            : insertFilesAt(picked.files, at),
        ),
      addAgentNode: (agentConfigId, at) => void addAgentNodeAt(agentConfigId, at),
      pasteSticky: (payload, at) => void pasteStickyAt(payload, at),
      resetView: () => setCanvasTransform({ x: 0, y: 0, scale: 1 }),
      editNode: (nodeId) => setEditingNodeId(nodeId),
      duplicateNode: (nodeId) => void duplicateNode(nodeId),
      startLink: (nodeId) => handleLink(nodeId),
      cycleLayout: (nodeId) => void cycleNodeLayout(nodeId),
      toggleSelect: (nodeId) => toggleNodeSelection(nodeId),
      deleteNode: (nodeId) => removeNodeId(nodeId),
      deleteEdge: (edgeId) => deleteEdge(edgeId),
      linkNodesToHub: (nodeIds, hubId) => void linkNodesToHub(nodeIds, hubId),
      synthesizeSelected: () => void handlePublish(),
      clearSelection: () => clearSelection(),
      deleteNodes: (nodeIds) => void deleteNodes(nodeIds),
    }),
    [
      createNodeAt, insertFilesAt, insertPathsAt, addAgentNodeAt, pasteStickyAt, setCanvasTransform,
      duplicateNode, handleLink, cycleNodeLayout, toggleNodeSelection, removeNodeId, deleteEdge,
      linkNodesToHub, handlePublish, clearSelection, deleteNodes,
    ],
  );

  const runAgentAnalysisFromCard = (agentNodeId: string) => {
    if (isAnyAiBusy) return;
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId && n.type === 'agent');
    if (!agentNode?.agentConfigId) return;

    const neighborIds: string[] = [];
    for (const edge of edges) {
      if (edge.from === agentNodeId) neighborIds.push(edge.to);
      else if (edge.to === agentNodeId) neighborIds.push(edge.from);
    }
    neighborIds.sort();

    for (const cid of neighborIds) {
      const n = dynamicNodes.find(x => x.id === cid);
      if (!n || n.type === 'agent') continue;
      const el = nodesRef.current[cid];
      if (!el) continue;
      const text = getCanvasNodeContextText(el);
      if (!text) continue;
      void triggerAgentAnalysis(agentNode.agentConfigId, agentNodeId, cid);
      return;
    }

    void appAlert({ message: t('nodes.agent_no_context') });
  };

  const handleNodeDragEnd = (draggedId: string, finalPos: {x: number, y: number}) => {
    // Update position in database
    db.nodes.update(draggedId, { x: finalPos.x, y: finalPos.y });

    const draggedEl = nodesRef.current[draggedId];
    if (!draggedEl) return;
    
    // Convert to screen coordinates for accurate distance measurement (ignoring scale/pan for now for simplicity, bounding rect includes it)
    const dRect = draggedEl.getBoundingClientRect();
    const dCenterX = dRect.left + dRect.width / 2;
    const dCenterY = dRect.top + dRect.height / 2;

    const SNAP_DISTANCE = 150; // pixels

    const isDraggedAgent = dynamicNodes.find(n => n.id === draggedId)?.type === 'agent';

    let snapped = false;

    Object.keys(nodesRef.current).forEach(otherId => {
      if (otherId === draggedId || snapped) return;
      const otherEl = nodesRef.current[otherId];
      if (!otherEl) return;

      const isOtherAgent = dynamicNodes.find(n => n.id === otherId)?.type === 'agent';

      // One must be agent, other must not be agent ideally (or both are, but whatever)
      if ((isDraggedAgent && !isOtherAgent) || (!isDraggedAgent && isOtherAgent)) {
        const oRect = otherEl.getBoundingClientRect();
        const oCenterX = oRect.left + oRect.width / 2;
        const oCenterY = oRect.top + oRect.height / 2;

        const dist = Math.hypot(dCenterX - oCenterX, dCenterY - oCenterY);
        
        if (dist < SNAP_DISTANCE) {
          const agentId = isDraggedAgent ? draggedId : otherId;
          const contextId = isDraggedAgent ? otherId : draggedId;
          const agentConfigId = dynamicNodes.find(n => n.id === agentId)?.agentConfigId;
          
          if (agentConfigId && agentId && contextId) {
            snapped = true;
            // Optionally add edge to visualize snap (analysis runs only from the agent card button).
            if (!edges.find(e => (e.from === agentId && e.to === contextId) || (e.from === contextId && e.to === agentId))) {
               db.edges.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: agentId, to: contextId });
            }
          }
        }
      }
    });
  };

  return (
    <div className="bg-[#FAF9F6] font-serif text-[#1a1a1a] h-screen max-h-screen overflow-hidden flex flex-col paper-texture">
      
      <div className="flex flex-1 min-h-0 overflow-hidden" onPointerDown={() => { if (connectingFrom) setConnectingFrom(null); }}>
        {/* SideNavBar */}
        <Sidebar 
          isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
          activeTab={activeTab} setActiveTab={setActiveTab}
          userAvatar={userAvatar} setUserAvatar={setUserAvatar}
          userName={userName} setUserName={setUserName}
          userRole={userRole} setUserRole={setUserRole}
          setIsSettingsOpen={setIsSettingsOpen}
        />

        {activeTab === 'personal' && (
        <main 
          ref={mainRef} 
          className="flex-1 min-h-0 relative overflow-hidden bg-[#FAF9F6] paper-texture"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (DEBUG_DND) {
              const t = e.target;
              console.debug('[dnd:drop]', {
                tag: t instanceof Element ? t.tagName : String(t),
                types: Array.from(e.dataTransfer.types),
                filesLength: e.dataTransfer.files?.length ?? 0,
              });
            }
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const { x: ox, y: oy } = screenToCanvasPosition(
                e.clientX,
                e.clientY,
                e.currentTarget.getBoundingClientRect(),
                canvasTransform,
              );
              // 拖放沿用「以指针为中心」的落点（节点约 200 宽高的一半）；
              // 右键菜单新建则以点击点为左上角，见 CanvasContextMenu。
              await insertFilesAt(Array.from(e.dataTransfer.files), { x: ox - 100, y: oy - 100 });
            }
          }}
          onContextMenu={(e) => openContextMenu(e, { kind: 'canvas' })}
        >
          {/* 画布背景：左键框选、中键平移 */}
          <div
            className="absolute inset-0 z-0"
            onPointerDown={handleCanvasBackgroundPointerDown}
          />

          {/* 框选矩形（屏幕坐标，不随画布 transform 缩放） */}
          {marquee && (
            <div
              data-canvas-marquee=""
              className="pointer-events-none absolute z-50 rounded-sm border border-[#C2410C] bg-[#C2410C]/10"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          )}

          {/* Symmetrical Controls */}
          <CanvasHistoryPopover canvases={canvases} activeCanvasId={activeCanvasId} setActiveCanvasId={setActiveCanvasId} />

          {/* Transformed content container */}
          <div className="absolute top-6 right-6 flex items-center z-40 gap-3">
              <Tooltip
                label={isPublishing ? t('nodes.ai_loading') : `${t('sidebar.publish')} (${selectedNodes.size})`}
              >
                <button
                  onClick={handlePublish}
                  disabled={selectedNodes.size === 0 || isAnyAiBusy}
                  className={`p-3 rounded-full shadow-md transition-all flex items-center justify-center border ${
                    selectedNodes.size > 0
                      ? 'bg-[#C2410C] text-white border-[#a0350a]/50 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100'
                      : 'bg-white text-[#1a1a1a] border-[#E6E4DF] hover:scale-105 hover:border-[#C2410C] hover:text-[#C2410C] disabled:opacity-50 disabled:hover:scale-100 disabled:hover:border-[#E6E4DF] disabled:hover:text-[#1a1a1a]'
                  }`}
                >
                  {isPublishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />}
                </button>
              </Tooltip>

              <Tooltip label={t('canvas.full_screen')}>
                <button
                  onClick={toggleFullscreen}
                  className="bg-white text-[#1a1a1a] p-3 rounded-full shadow-md hover:scale-105 transition-all border border-[#E6E4DF] flex items-center justify-center hover:border-[#C2410C] hover:text-[#C2410C]"
                >
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
              </Tooltip>
          </div>

          <div 
            ref={contentContainerRef}
            className="absolute inset-0 origin-top-left z-0 pointer-events-none"
            style={{ transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})` }}
          >
            <CanvasEdgeLines
              edges={edges} connectingFrom={connectingFrom}
              svgRef={svgRef} edgeLabelsRef={edgeLabelsRef}
              hoveredEdgeId={hoveredEdgeId} setHoveredEdgeId={setHoveredEdgeId}
              deleteEdge={deleteEdge}
              onEdgeContextMenu={(e, edgeId) => openContextMenu(e, { kind: 'edge', edgeId })}
            />

            <div className="absolute inset-0 z-30 w-[1px] h-[1px] pointer-events-none"> 
              {/* All Nodes from Database */}
              {dynamicNodes.map((node) => {
                const rotation = 
                  (node.type === 'note' || node.type === 'text') ? (node.layout === 0 || node.layout === undefined ? 1 : 0) :
                  (node.type === 'theme') ? (node.layout === 0 || node.layout === undefined ? -1 : 0) :
                  (node.type === 'image') ? -1 :
                  (node.type === 'video') ? 1 :
                  (node.type === 'document') ? 1 : 0;

                return (
                  <DraggableNode 
                    key={node.id} 
                    id={node.id} nodesRef={nodesRef} isConnecting={connectingFrom !== null} onLink={handleLink}
                    initialX={node.x} initialY={node.y} 
                    initialWidth={node.width} initialHeight={node.height}
                    onDelete={() => removeNodeId(node.id)} scale={canvasTransform.scale}
                    rotation={rotation}
                    onCycleLayout={
                      nodeSupportsCycleLayout(node.type)
                        ? () => void cycleNodeLayout(node.id)
                        : undefined
                    }
                    isSelected={selectedNodes.has(node.id)}
                    isEditing={editingNodeId === node.id}
                    onToggleSelect={() => toggleNodeSelection(node.id)}
                    allowPalette={true}
                    onDragEnd={handleNodeDragEnd}
                    onResizeEnd={(size) => {
                      db.nodes.update(node.id, size);
                    }}
                    glassSurface={
                      (node.type === 'note' || node.type === 'text') && (node.layout ?? 0) === 1
                    }
                    onStickyActivate={
                      node.type === 'note' || node.type === 'text'
                        ? (nid) => {
                            lastStickyClickIdRef.current = nid;
                          }
                        : undefined
                    }
                    onContextMenu={openNodeContextMenu}
                >
                  <NodeRenderer
                    node={node}
                    editingNodeId={editingNodeId}
                    setEditingNodeId={setEditingNodeId}
                    agentConfigs={agentConfigs}
                    analyzingAgentNodeId={analyzingAgentNodeId}
                    onAgentRunAnalysis={runAgentAnalysisFromCard}
                    isAgentAnalysisActionDisabled={isAnyAiBusy}
                    onAiFollowUp={submitAiThreadFollowUp}
                    followUpLoadingNodeId={followUpParentId}
                    streamingAiNodeId={streamingAiNodeId}
                    isFollowUpGloballyDisabled={isAnyAiBusy}
                  />
                </DraggableNode>
              );
            })}
            </div>

          </div>

        {/* AI Prompt Bar & Toolbar */}
        <CanvasToolbar
          isToolbarAiLoading={isToolbarAiLoading || isToolbarIntentPreflight}
          isInputDisabled={isAnyAiBusy}
          aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          handleAiSubmit={handleAiSubmit}
          canvasTransform={canvasTransform}
          setCanvasTransform={setCanvasTransform}
          onZoomToFit={handleZoomToFit}
          attachments={attachments}
          onAddAttachments={(files) => void addAttachments(files)}
          onRemoveAttachment={removeAttachment}
          intentClarification={intentClarification}
          isIntentSubmitting={isToolbarAiLoading}
          onCancelIntentClarification={cancelIntentClarification}
          onConfirmIntentClarification={(finalRequest) => void confirmIntentClarification(finalRequest)}
        />

        {isAiUnconfigured && !isOnboardingDismissed && (
          <OnboardingCard
            onOpenSettings={() => {
              setIsOnboardingDismissed(true);
              setIsSettingsOpen(true);
            }}
            onDismiss={() => setIsOnboardingDismissed(true)}
          />
        )}

        {contextMenu && (
          <CanvasContextMenu
            menu={contextMenu}
            onClose={closeContextMenu}
            agentConfigs={agentConfigs}
            nodesById={nodesById}
            selectedNodes={selectedNodes}
            actions={contextMenuActions}
            isSynthesizeDisabled={isAnyAiBusy}
          />
        )}
        </main>
        )}

        {activeTab === 'reference' && (
          <Reference
            articles={articles}
            activeReferenceId={activeReferenceId}
            setActiveReferenceId={setActiveReferenceId}
            onOpenCanvas={(canvasId) => {
              setActiveCanvasId(canvasId);
              setActiveTab('personal');
            }}
          />
        )}
        {activeTab === 'lab' && <ResearchLab aiConfig={aiConfig} callAI={callUniversalAI} />}
        {/* Agents in Agents Studio need consistent write access */}
        {activeTab === 'agents' && <AgentsStudio agentConfigs={agentConfigs} setAgentConfigs={async (newConfigs) => {
          const nextIds = new Set(newConfigs.map((c) => c.id));
          const existing = await db.agents.toArray();
          await Promise.all(existing.filter((row) => !nextIds.has(row.id)).map((row) => db.agents.delete(row.id)));
          await Promise.all(newConfigs.map((config) => db.agents.put(config)));
        }} aiConfig={aiConfig} callAI={callUniversalAI} />}
        <AISettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={aiConfig} setConfig={setAiConfig} />
      </div>
    </div>
  );
}
