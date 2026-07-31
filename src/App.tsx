import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type CanvasNode } from './db';
import {
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { commitCanvasInlineEditing } from './utils/commitCanvasInlineEditing';
import { registerCanvasUnloadFlush } from './utils/registerCanvasUnloadFlush';
import { getCanvasNodeContextText } from './utils/canvasNodeContextText';
import { screenToCanvasPosition } from './utils/canvas';
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
import { autoCheckForUpdateOnce } from './services/appUpdate';
import { MIMO_TOKEN_PLAN_BASE_URL } from './constants/mimo';
import { DOUBAO_ARK_BASE_URL } from './constants/doubao';
import { NodeRenderer } from './components/nodes/NodeRenderer';
import { useSeedData } from './hooks/useSeedData';
import { useUserProfile } from './hooks/useUserProfile';
import { useFullscreen } from './hooks/useFullscreen';
import { useAppTheme } from './hooks/useAppTheme';
import { useCanvasGrid } from './hooks/useCanvasGrid';
import { CANVAS_GRID_SIZE } from './services/canvasGrid';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import { useCanvasMarquee } from './hooks/useCanvasMarquee';
import { useCanvasLinkDrag } from './hooks/useCanvasLinkDrag';
import { computeFitTransform, unionNodeBoundsInCanvasSpace } from './utils/zoomToFit';
import { useNodeActions } from './hooks/useNodeActions';
import { pickFiles } from './utils/filePicker';
import { saveMediaAs } from './utils/saveMediaAs';
import { useAiActions } from './hooks/useAiActions';
import { useNativeFileDrop } from './hooks/useNativeFileDrop';
import { useImageGenActions } from './hooks/useImageGenActions';
import { migrateBase64MediaNodes } from './services/migrateBase64Media';
import {
  emptyAiConfigV2,
  isAiConfigEmpty,
  normalizeAiConfig,
  resolveActiveChatConfig,
} from './services/aiConfig';
import type { AIConfigV2 } from './types/aiConfig';
import { useAppDialog } from './components/AppDialogProvider';
import {
  buildStickyClipboardPayload,
  isTextEditingTarget,
  parseStickyClipboardPayload,
  stickyPastePosition,
} from './utils/noteClipboard';

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
  const appTheme = useAppTheme();
  /** 选区 id 列表（稳定引用）：多选整体拖拽要把它透传给每个 DraggableNode。 */
  const selectedNodeIds = React.useMemo(() => [...selectedNodes], [selectedNodes]);
  const gridEnabled = useCanvasGrid();

  // Canvas interaction (transform, pan, zoom, edge lines)
  const { canvasTransform, setCanvasTransform, transformRef, handlePanStart, isSpacePanning } =
    useCanvasInteraction(
      mainRef, contentContainerRef, svgRef, edgeLabelsRef, nodesRef, connectingFrom, setConnectingFrom,
    );

  const { menu: contextMenu, openContextMenu, closeContextMenu } = useCanvasContextMenu(mainRef, transformRef);

  // 左键框选（中键平移由 useCanvasInteraction 负责）
  const { marquee, handleMarqueeStart } = useCanvasMarquee({ mainRef, nodesRef, setSelectedNodes });

  /**
   * 连线落在画布空白处：弹「新建并连上」菜单，**同时结束连线态**。
   *
   * 清掉 `connectingFrom` 是关键：菜单已经把 `fromId` 记在自己的 target 里，不再需要
   * 这个状态。以前不清，于是关掉菜单时的那次点击又会命中这里、菜单再弹一次——
   * 用户看到的就是「点一次建一张，怎么点都还在建」，而且没有办法把线放下。
   */
  const dropLinkOnCanvas = useCallback(
    (
      fromId: string,
      at: {
        clientX: number;
        clientY: number;
        target: EventTarget | null;
        preventDefault: () => void;
        stopPropagation: () => void;
      },
    ) => {
      setConnectingFrom(null);
      openContextMenu(at, { kind: 'link-drop', fromId });
    },
    [openContextMenu],
  );

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
      if (e.button === 1) {
        handlePanStart(e);
        return;
      }
      if (e.button !== 0) return;
      // 正在拉线时落在空白处：不丢弃这根线，改为当场问「要建张什么卡」再自动连上。
      // 此时也不该同时开始框选。
      if (connectingFrom) {
        dropLinkOnCanvas(connectingFrom, e);
        return;
      }
      handleMarqueeStart(e);
    },
    [editingNodeId, dynamicNodes, handlePanStart, handleMarqueeStart, connectingFrom, dropLinkOnCanvas],
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

  /**
   * 配置以 v2（多服务商）存放，读出来时统一过一遍 normalizeAiConfig：
   * 它认得 v1 扁平结构并就地迁移，坏数据一律降级为空配置而不是把应用卡死。
   */
  const [aiConfigV2, setAiConfigV2] = useState<AIConfigV2>(() => {
    const saved = localStorage.getItem('ai_config');
    if (!saved) return emptyAiConfigV2();
    try {
      const raw = JSON.parse(saved);
      // v1 的 Base URL 兜底修正要在迁移之前做，迁移完就没有扁平字段了
      const prepared = raw?.version === 2 ? raw : migrateStoredAiConfig(raw) ?? raw;
      return normalizeAiConfig(prepared);
    } catch {
      return emptyAiConfigV2();
    }
  });

  /**
   * 对话链路（services/ai、ResearchLab、AgentsStudio、useAiActions）继续吃扁平形状。
   * 这层垫片是这次重构的爆炸半径边界，见 services/aiConfig。
   */
  const aiConfig = React.useMemo(() => resolveActiveChatConfig(aiConfigV2), [aiConfigV2]);

  /** 未配置任何 API Key（本地 GGUF 只要有模型路径即算已配置）。 */
  const isAiUnconfigured = isAiConfigEmpty(aiConfigV2);

  useEffect(() => {
    localStorage.setItem('ai_config', JSON.stringify(aiConfigV2));
  }, [aiConfigV2]);

  // 启动静默自检：有新版就在侧边栏设置按钮上挂个点，查不到就安静躺下，不打断
  useEffect(() => {
    autoCheckForUpdateOnce();
  }, []);

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

  // 旧的 base64 节点搬进文件存储。best-effort，失败原样留着靠 content 兜底显示
  useEffect(() => {
    void migrateBase64MediaNodes().then((count) => {
      if (count > 0) console.info(`[Spoor] 已把 ${count} 个节点的内联数据搬到文件存储`);
    });
  }, []);

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


  // Node actions (CRUD, selection, linking)
  const {
    toggleNodeSelection, handleLink, deleteEdge, removeNodeId,
    createNodeAt, createNodeAtLinkedFrom, linkNodes, addAgentNodeAt, insertFilesAt, insertPathsAt, duplicateNode, pasteStickyAt,
    clearSelection, deleteNodes, linkNodesToHub,
  } = useNodeActions({
    activeCanvasId, nodesRef, connectingFrom, setConnectingFrom, edges, selectedNodes, setSelectedNodes, transformRef,
  });

  // 从端口按住拖到目标松手即连；Esc / 右键放弃。点击-点击的老手势仍然可用。
  useCanvasLinkDrag({
    connectingFrom,
    onDropOnNode: handleLink,
    onDropOnCanvas: (fromId, clientX, clientY) =>
      dropLinkOnCanvas(fromId, {
        clientX,
        clientY,
        target: mainRef.current,
        preventDefault: () => {},
        stopPropagation: () => {},
      }),
    onCancel: () => setConnectingFrom(null),
  });

  /**
   * 原生拖放落点：Tauri 给的是窗口坐标，先换算成画布坐标。
   * 以指针为中心（节点约 200 宽高的一半）；右键菜单新建则以点击点为左上角。
   */
  const handleNativeFileDrop = useCallback(
    (paths: string[], point: { x: number; y: number }) => {
      const main = mainRef.current;
      if (!main) return;
      const { x, y } = screenToCanvasPosition(
        point.x,
        point.y,
        main.getBoundingClientRect(),
        transformRef.current ?? { x: 0, y: 0, scale: 1 },
      );
      void insertPathsAt(paths, { x: x - 100, y: y - 100 });
    },
    [insertPathsAt, transformRef],
  );

  const { isDragOver: isFileDragOver } = useNativeFileDrop({
    enabled: activeTab === 'personal',
    onDrop: handleNativeFileDrop,
  });

  // 生图节点：状态放内存，生成中不入库（重启后不会卡在转圈上）
  const {
    generatingNodeIds: generatingImageNodeIds,
    generate: generateImage,
    cancel: cancelImage,
    deleteResult: deleteImageResult,
    setActiveIndex: setImageActiveIndex,
    patchNode: patchImageGenNode,
    outputAsImageNode,
  } = useImageGenActions({
    aiConfig: aiConfigV2,
    activeCanvasId,
    nodes: dynamicNodes,
    edges,
  });

  // Right-click menu (canvas / node / nodes / edge)

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

  /** 另存为：图片/视频用原件路径，生图节点用当前选中的那一张结果。 */
  const saveNodeMediaAsFromCanvas = useCallback(
    async (nodeId: string) => {
      const node = await db.nodes.get(nodeId);
      if (!node) return;
      const rel =
        node.type === 'imagegen'
          ? node.imageGenResults?.[node.imageGenActiveIndex ?? 0]
          : node.filePath;
      if (rel) await saveMediaAs(rel);
    },
    [],
  );

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
      toggleSelect: (nodeId) => toggleNodeSelection(nodeId),
      deleteNode: (nodeId) => removeNodeId(nodeId),
      deleteEdge: (edgeId) => deleteEdge(edgeId),
      linkNodesToHub: (nodeIds, hubId) => void linkNodesToHub(nodeIds, hubId),
      synthesizeSelected: () => void handlePublish(),
      clearSelection: () => clearSelection(),
      deleteNodes: (nodeIds) => void deleteNodes(nodeIds),
      outputAsImageNode: (nodeId) => void outputAsImageNode(nodeId),
      saveNodeMediaAs: (nodeId) => void saveNodeMediaAsFromCanvas(nodeId),
      createNodeLinkedFrom: (nodeType, at, fromId) => {
        setConnectingFrom(null);
        void createNodeAtLinkedFrom(nodeType, at, fromId);
      },
      insertFileLinkedFrom: (accept, at, fromId) => {
        setConnectingFrom(null);
        void pickFiles(accept)
          .then((picked) =>
            picked.kind === 'paths'
              ? insertPathsAt(picked.paths, at)
              : insertFilesAt(picked.files, at),
          )
          .then((createdIds) => Promise.all(createdIds.map((id) => linkNodes(fromId, id))));
      },
    }),
    [
      createNodeAt, insertFilesAt, insertPathsAt, addAgentNodeAt, pasteStickyAt, setCanvasTransform,
      duplicateNode, handleLink, toggleNodeSelection, removeNodeId, deleteEdge,
      linkNodesToHub, handlePublish, clearSelection, deleteNodes, outputAsImageNode,
      saveNodeMediaAsFromCanvas, createNodeAtLinkedFrom, linkNodes,
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
    <div className="bg-app-surface font-serif text-app-text h-screen max-h-screen overflow-hidden flex flex-col paper-texture">
      
      <div
        className="flex flex-1 min-h-0 overflow-hidden"
        onPointerDown={(e) => {
          // 画布空白处由 handleCanvasBackgroundPointerDown 接管（要弹「新建并连上」菜单）；
          // 这里只负责在画布之外（侧边栏等）按下时取消连线。
          if (!connectingFrom) return;
          if ((e.target as HTMLElement).closest('[data-canvas-surface]')) return;
          setConnectingFrom(null);
        }}
      >
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
          data-canvas-surface=""
          // 按住空格进入「手型」模式：光标先变，用户才知道现在拖的是画布而不是卡片
          className={`flex-1 min-h-0 relative overflow-hidden bg-app-surface paper-texture ${
            isSpacePanning ? 'cursor-grab [&_*]:cursor-grab' : ''
          }`}
          onContextMenu={(e) => openContextMenu(e, { kind: 'canvas' })}
        >
          {/* 画布背景：左键框选、中键平移 */}
          <div
            data-canvas-background=""
            className="absolute inset-0 z-0"
            onPointerDown={handleCanvasBackgroundPointerDown}
          />

          {/*
            网格画在背景层而不是 transform 容器里：容器的 scale 会把 1px 的网格点
            一起放大成糊团。这里改为按 scale 换算 background-size / position，
            点始终是 1px，但与画布内容严丝合缝地一起平移缩放。
          */}
          {gridEnabled && (
            <div
              data-canvas-grid=""
              className="canvas-grid pointer-events-none absolute inset-0 z-0"
              style={{
                backgroundSize: `${CANVAS_GRID_SIZE * canvasTransform.scale}px ${CANVAS_GRID_SIZE * canvasTransform.scale}px`,
                backgroundPosition: `${canvasTransform.x}px ${canvasTransform.y}px`,
              }}
            />
          )}

          {/* 原生拖放没有 DataTransfer，浏览器也不给放置光标，只能自己画个提示 */}
          {isFileDragOver && (
            <div
              data-file-drag-overlay=""
              className="pointer-events-none absolute inset-3 z-[60] rounded-2xl border-2 border-dashed border-app-accent bg-app-accent/5 flex items-center justify-center"
            >
              <span className="font-sans text-sm font-bold text-app-accent bg-app-surface-raised/90 px-4 py-2 rounded-xl shadow-sm">
                {t('canvas.drop_files_hint')}
              </span>
            </div>
          )}

          {/* 框选矩形（屏幕坐标，不随画布 transform 缩放） */}
          {marquee && (
            <div
              data-canvas-marquee=""
              className="pointer-events-none absolute z-50 rounded-sm border border-app-accent bg-app-accent/10"
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
              <Tooltip label={t('canvas.full_screen')}>
                <button
                  onClick={toggleFullscreen}
                  className="bg-app-surface-raised text-app-text p-3 rounded-full shadow-md hover:scale-105 transition-all border border-app-border flex items-center justify-center hover:border-app-accent hover:text-app-accent"
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
                /** 只有经典外壳（layout 0）带手写便签式的轻微倾斜；形态现在来自全局主题。 */
                const rotation = 
                  (node.type === 'note' || node.type === 'text') ? (appTheme.noteLayout === 0 ? 1 : 0) :
                  (node.type === 'theme') ? (appTheme.themeLayout === 0 ? -1 : 0) :
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
                    isSelected={selectedNodes.has(node.id)}
                    selectedIds={selectedNodeIds}
                    isEditing={editingNodeId === node.id}
                    onToggleSelect={() => toggleNodeSelection(node.id)}
                    allowPalette={true}
                    onDragEnd={handleNodeDragEnd}
                    onResizeEnd={(size) => {
                      db.nodes.update(node.id, size);
                    }}
                    glassSurface={
                      (node.type === 'note' || node.type === 'text') && appTheme.noteLayout === 1
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
                    aiConfig={aiConfigV2}
                    allNodes={dynamicNodes}
                    edges={edges}
                    generatingImageNodeIds={generatingImageNodeIds}
                    onImageGenGenerate={(id) => void generateImage(id)}
                    onImageGenCancel={(id) => void cancelImage(id)}
                    onImageGenPatch={(id, patch) => void patchImageGenNode(id, patch)}
                    onImageGenDeleteResult={(id, index) => void deleteImageResult(id, index)}
                    onImageGenSetActiveIndex={(id, index) => void setImageActiveIndex(id, index)}
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
        <AISettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={aiConfigV2} setConfig={setAiConfigV2} />
      </div>
    </div>
  );
}
