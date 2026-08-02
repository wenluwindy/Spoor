import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type CanvasNode } from './db';
import {
  Maximize2,
  Minimize2,
  Redo2,
  Undo2,
} from 'lucide-react';
import { commitCanvasInlineEditing } from './utils/commitCanvasInlineEditing';
import { registerCanvasUnloadFlush } from './utils/registerCanvasUnloadFlush';
import { getCanvasNodeContextText } from './utils/canvasNodeContextText';
import { getCanvasCenterPosition, screenToCanvasPosition } from './utils/canvas';
import { buildResearchFrame } from './services/researchToCanvas';
import { buildResearchStepCards } from './services/researchStepToCanvas';
import { CanvasEdgeLines } from './components/canvas/CanvasEdgeLines';
import { CanvasNodeItem, type CanvasNodeSharedProps } from './components/canvas/CanvasNodeItem';
import { SnapGuideLines } from './components/canvas/SnapGuideLines';
import { CanvasMinimap } from './components/canvas/CanvasMinimap';
import { OrganizePreviewBar, OrganizePreviewGhosts } from './components/canvas/OrganizePreview';
import { useCanvasOrganize } from './hooks/useCanvasOrganize';
import { GlobalSearchPanel } from './components/GlobalSearchPanel';
import { TagFilterBar } from './components/canvas/TagFilterBar';
import { usePresentation } from './hooks/usePresentation';
import { PresentationHud } from './components/canvas/PresentationHud';
import { buildPresentationOrder } from './utils/presentationOrder';
import { nodesInsideFrame } from './services/canvasFrame';
import { buildSnapTargets, setSnapTargets } from './services/canvasSnapGuides';
import { alignNodes, distributeNodes, type AlignMode, type DistributeAxis, type AlignableNode } from './utils/canvasAlign';
import { deleteCanvasTemplate, insertCanvasTemplate, saveCanvasTemplate } from './services/canvasTemplates';
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
import { DOUBAO_ARK_BASE_URL } from './constants/doubao';
import { NodeRenderer } from './components/nodes/NodeRenderer';
import { useSeedData } from './hooks/useSeedData';
import { useUserProfile } from './hooks/useUserProfile';
import { useFullscreen } from './hooks/useFullscreen';
import { useAppTheme } from './hooks/useAppTheme';
import { useCanvasGrid } from './hooks/useCanvasGrid';
import { CANVAS_GRID_SIZE } from './services/canvasGrid';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useCanvasKeyboard } from './hooks/useCanvasKeyboard';
import { redoCanvasHistory, undoCanvasHistory } from './services/canvasHistory';
import {
  addEdgesRecorded,
  addNodesAndEdgesRecorded,
  moveNodeRecorded,
  resizeNodeRecorded,
  updateNodeRecorded,
} from './services/canvasMutations';
import { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import { useCanvasClipboard } from './hooks/useCanvasClipboard';
import { useCanvasMarquee } from './hooks/useCanvasMarquee';
import { useCanvasLinkDrag } from './hooks/useCanvasLinkDrag';
import { useCanvasViewOps } from './hooks/useCanvasViewOps';
import { useAppStartup } from './hooks/useAppStartup';
import { CanvasSearchPanel } from './components/canvas/CanvasSearchPanel';
import { stepSearchIndex } from './utils/canvasSearch';
import { useCanvasSearch } from './hooks/useCanvasSearch';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH, groupIdsForDrag } from './services/canvasFrame';
import { resolveAgentLocalizedName } from './utils/aiI18n';
import { useNodeActions } from './hooks/useNodeActions';
import { pickFiles } from './utils/filePicker';
import { saveMediaAs } from './utils/saveMediaAs';
import { useAiActions } from './hooks/useAiActions';
import { useNativeFileDrop } from './hooks/useNativeFileDrop';
import { useImageGenActions } from './hooks/useImageGenActions';
import { useWebNodeActions } from './hooks/useWebNodeActions';
import { useCanvasRecompute } from './hooks/useCanvasRecompute';
import { isFetchableUrl } from './services/webPage';
import {
  emptyAiConfigV2,
  isAiConfigEmpty,
  normalizeAiConfig,
  resolveActiveChatConfig,
} from './services/aiConfig';
import { loadAiConfig, saveAiConfig } from './services/aiConfigStore';
import type { AIConfigV2 } from './types/aiConfig';
import { useAppDialog } from './components/AppDialogProvider';
import { isTextEditingTarget } from './utils/noteClipboard';
import {
  buildCanvasClipboardPayload,
  materializeCanvasClipboard,
  parseCanvasClipboardPayload,
} from './utils/canvasClipboard';

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
  const { alert: appAlert, prompt: appPrompt } = useAppDialog();
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
  // where('canvasId') 走索引而不是 filter 全表扫。缺 canvasId 的旧行已由 v5 迁移
  // 补成 'default'、新行由 db.ts 的 creating hook 盖章，这里不再需要运行时兜底。
  const dynamicNodes = useLiveQuery(() =>
    db.nodes.where('canvasId').equals(activeCanvasId).toArray()
  , [activeCanvasId]) || [];
  const edges = useLiveQuery(() =>
    db.edges.where('canvasId').equals(activeCanvasId).toArray()
  , [activeCanvasId]) || [];
  const canvases = useLiveQuery(() => db.canvases.toArray()) || [];
  const templates = useLiveQuery(() => db.templates.orderBy('createdAt').reverse().toArray()) || [];

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

  /** 演示模式的点击桥：hook 在下方才初始化，背景点击处理器经这个 ref 读它。 */
  const presentationClickRef = useRef<{ active: boolean; next: () => void }>({
    active: false,
    next: () => {},
  });

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
      // 演示中点空白 = 下一张（presentation 在下方才初始化，经 ref 桥接）
      if (presentationClickRef.current.active) {
        presentationClickRef.current.next();
        return;
      }
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

  /**
   * 视口裁剪 / 缩放适应 / 聚焦单卡 / 整图导出：全是 refs+transform 的 DOM 活，
   * 整块住在 useCanvasViewOps（0.5.0 拆薄），行为与原先在 App 里时一致。
   */
  const {
    renderedNodes,
    renderedEdges,
    handleZoomToFit,
    focusNode,
    exportCanvasImage,
  } = useCanvasViewOps({
    mainRef,
    contentContainerRef,
    nodesRef,
    transformRef,
    setCanvasTransform,
    canvasTransform,
    activeTab,
    dynamicNodes,
    edges,
    canvases,
    activeCanvasId,
    setSelectedNodes,
    appAlert,
    t,
  });

  /** 拖动吸附的参照线：当前画布全部卡片的左/中/右与上/中/下（高度未知的只有顶线）。 */
  useEffect(() => {
    setSnapTargets(
      buildSnapTargets(
        dynamicNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.width ?? 320,
          height: n.height ?? 0,
        })),
      ),
    );
    return () => setSnapTargets(null);
  }, [dynamicNodes]);

  /**
   * 配置以 v2（多服务商）存放，读出来时统一过一遍 normalizeAiConfig：
   * 它认得 v1 扁平结构并就地迁移，坏数据一律降级为空配置而不是把应用卡死。
   *
   * 0.5.0 起持久化收口到 services/aiConfigStore（桌面端 = 系统密钥库，
   * localStorage 只是浏览器调试与降级路径），启动加载因此从同步变异步：
   * 加载完成前以空配置渲染——表现与「未配置引导卡」一致，加载完成后填入。
   */
  const [aiConfigV2, setAiConfigV2] = useState<AIConfigV2>(emptyAiConfigV2);
  /** 首次加载完成前不写回，否则会拿初始空配置把密钥库里的真配置盖掉。 */
  const aiConfigLoadedRef = useRef(false);

  useEffect(() => {
    void loadAiConfig().then(({ raw }) => {
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          // v1 的 Base URL 兜底修正要在迁移之前做，迁移完就没有扁平字段了
          const prepared = parsed?.version === 2 ? parsed : migrateStoredAiConfig(parsed) ?? parsed;
          setAiConfigV2(normalizeAiConfig(prepared));
        } catch {
          // 坏数据降级为空配置而不是把应用卡死
        }
      }
      aiConfigLoadedRef.current = true;
    });
  }, []);

  /**
   * 对话链路（services/ai、ResearchLab、AgentsStudio、useAiActions）继续吃扁平形状。
   * 这层垫片是这次重构的爆炸半径边界，见 services/aiConfig。
   */
  const aiConfig = React.useMemo(() => resolveActiveChatConfig(aiConfigV2), [aiConfigV2]);

  /** 未配置任何 API Key（本地 GGUF 只要有模型路径即算已配置）。 */
  const isAiUnconfigured = isAiConfigEmpty(aiConfigV2);

  useEffect(() => {
    if (!aiConfigLoadedRef.current) return;
    // 降级（密钥库坏/不可用）由 aiConfigStore 内部记账，设置页的警示条订阅它
    void saveAiConfig(aiConfigV2);
  }, [aiConfigV2]);

  // 启动杂务（更新自检 / 每日快照 / 镜像对账 / base64 媒体迁移）整块住在 useAppStartup
  useAppStartup({ t, appAlert });

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

  /**
   * Ctrl+X 要删掉刚剪走的卡片，但删除逻辑住在下面的 `useNodeActions` 里。
   * 用 ref 把它转过去，剪贴板监听就不必等到那之后才挂。
   */
  const deleteNodesRef = useRef<(ids: string[]) => Promise<void>>(async () => {});

  /** 同理：粘贴链接要建网页卡片，而建卡的动作在下面才拿得到。 */
  const createWebNodeRef = useRef<(url: string, at?: { x: number; y: number }) => Promise<string>>(
    async () => '',
  );

  // 画布剪贴板（Ctrl+C/X/V 与"粘贴链接落网页卡"）整块住在 useCanvasClipboard
  useCanvasClipboard({
    enabled: activeTab === 'personal',
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodeIds,
    lastStickyClickIdRef,
    deleteNodesRef,
    createWebNodeRef,
    setSelectedNodes,
  });


  // Node actions (CRUD, selection, linking)
  const {
    toggleNodeSelection, handleLink, deleteEdge, removeNodeId,
    createNodeAt, createNodeAtLinkedFrom, linkNodes, addAgentNodeAt, insertFilesAt, insertPathsAt, duplicateNode, pasteClipboardAt,
    clearSelection, deleteNodes, linkNodesToHub, duplicateNodes, nudgeNodes, addCanvasLinkNodeAt, addWebNodeAt, extractNoteFrom,
  } = useNodeActions({
    activeCanvasId, nodesRef, connectingFrom, setConnectingFrom, edges, selectedNodes, setSelectedNodes, transformRef,
  });

  deleteNodesRef.current = deleteNodes;

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

  // 网页卡片：抓取态放内存，与生图同一套取舍
  const { fetchingNodeIds: fetchingWebNodeIds, fetchInto: fetchWebNode } = useWebNodeActions();

  /** 新建一张网页卡片并立刻开抓。粘贴链接与右键新建都走这里。 */
  const createWebNodeAndFetch = useCallback(
    async (url: string, at?: { x: number; y: number }) => {
      const id = await addWebNodeAt(at, url);
      await fetchWebNode(id, url);
      return id;
    },
    [addWebNodeAt, fetchWebNode],
  );

  createWebNodeRef.current = createWebNodeAndFetch;

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

  /**
   * 跨画布传送门。
   *
   * `type` 上有索引，所以「全库的传送门」这个查询很便宜，可以一直挂着——反链
   * （谁指向当前画布）要靠它，而反链要在切画布后立刻是对的。
   */
  const canvasLinkNodes = useLiveQuery(() => db.nodes.where('type').equals('canvasLink').toArray()) || [];

  /** 当前画布上的传送门指向了哪些画布，各有多少张卡片。 */
  const portalTargetIds = React.useMemo(
    () => [...new Set(dynamicNodes.filter((n) => n.type === 'canvasLink' && n.targetCanvasId).map((n) => n.targetCanvasId!))],
    [dynamicNodes],
  );
  const portalTargetKey = portalTargetIds.join(',');
  const targetNodeCountByCanvasId = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    for (const id of portalTargetIds) {
      counts.set(id, await db.nodes.where('canvasId').equals(id).count());
    }
    return counts;
  }, [portalTargetKey]) || new Map<string, number>();

  /** 反链：目标画布 id → 指向它的那些画布 id（去重）。 */
  const backlinksByCanvasId = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of canvasLinkNodes) {
      if (!node.targetCanvasId) continue;
      const source = node.canvasId || 'default';
      if (source === node.targetCanvasId) continue;
      const list = map.get(node.targetCanvasId) ?? [];
      if (!list.includes(source)) list.push(source);
      map.set(node.targetCanvasId, list);
    }
    return map;
  }, [canvasLinkNodes]);

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
    regenerateAiNode,
    followUpParentId,
    streamingAiNodeId,
    isAnyAiBusy,
    aiPrompt,
    setAiPrompt,
    handlePublish,
    triggerAgentAnalysis,
    relayNodeToAgent,
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

  // AI 整理画布（C8）：分组预览 → 应用/取消
  const { isOrganizing, runOrganize, applyPendingOrganize, cancelPendingOrganize } =
    useCanvasOrganize({ aiConfig, activeCanvasId, dynamicNodes, nodesRef });


  /**
   * 撤销 / 重做。
   *
   * AI 忙的时候整个禁用：流式写入刻意不进撤销栈（见 `canvasHistory` 的边界说明），
   * 这时候撤销很可能把正在被写入的那张卡删掉，而剩下的流还会继续往一个已经不存在的
   * 行里写。等它写完再撤，语义才是干净的「删掉这张 AI 卡」。
   */
  const { canUndo, canRedo } = useCanvasHistory(activeCanvasId);

  const handleUndo = useCallback(() => {
    if (isAnyAiBusy) return;
    void undoCanvasHistory(activeCanvasId);
  }, [activeCanvasId, isAnyAiBusy]);

  const handleRedo = useCallback(() => {
    if (isAnyAiBusy) return;
    void redoCanvasHistory(activeCanvasId);
  }, [activeCanvasId, isAnyAiBusy]);

  const agentNameById = useCallback(
    (agentConfigId: string | undefined) => {
      if (!agentConfigId) return undefined;
      const agent = agentConfigs.find((a) => a.id === agentConfigId);
      return agent ? resolveAgentLocalizedName(agent) : undefined;
    },
    [agentConfigs],
  );

  // 画布内搜索（Ctrl+F）整块住在 useCanvasSearch（focusNode 来自 useCanvasViewOps）
  const {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchIndex,
    setSearchIndex,
    searchMatches,
    otherCanvasSearchResults,
    closeSearch,
  } = useCanvasSearch({
    dynamicNodes,
    activeCanvasId,
    canvases,
    agentNameById,
    onFocusMatch: focusNode,
  });

  // 演示模式（B7）：逐卡聚焦播放器
  const presentation = usePresentation({ onFocusNode: focusNode });
  const { start: startPresentationRun } = presentation;
  presentationClickRef.current = { active: presentation.active, next: presentation.next };

  /**
   * 演示入口。startId 缺省 = 整张画布从根讲起；nodeIds 给了只讲该子集；
   * startId 是区域框时讲框住的那批卡（框本身是背景，不进播放序）。
   */
  const startPresentation = useCallback(
    (startId?: string, nodeIds?: string[]) => {
      const startNode = startId ? dynamicNodes.find((n) => n.id === startId) : undefined;
      let pool = nodeIds ? dynamicNodes.filter((n) => nodeIds.includes(n.id)) : dynamicNodes;
      let effectiveStart = startId;
      if (startNode?.type === 'frame') {
        const members = new Set(nodesInsideFrame(startNode, dynamicNodes));
        pool = dynamicNodes.filter((n) => members.has(n.id));
        effectiveStart = undefined;
      }
      const order = buildPresentationOrder(pool, edges, effectiveStart);
      if (order.length === 0) {
        void appAlert({ message: t('canvas.presentation.empty') });
        return;
      }
      startPresentationRun(order);
    },
    [dynamicNodes, edges, startPresentationRun, appAlert, t],
  );

  // 全局搜索（B5）：Ctrl+Shift+F 在任何页签都能呼出
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** 跨画布跳转：目标画布的节点要等 live query 回流后才能聚焦。 */
  const pendingFocusNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocusNodeIdRef.current;
    if (!id) return;
    if (dynamicNodes.some((n) => n.id === id)) {
      pendingFocusNodeIdRef.current = null;
      focusNode(id);
    }
  }, [dynamicNodes, focusNode]);
  /** 全局搜索点开研究会话：切页签并让实验室打开这一条历史。 */
  const [pendingResearchSessionId, setPendingResearchSessionId] = useState<string | null>(null);

  /**
   * 快捷键作用于「当前选区」。
   *
   * 选区放在 ref 里再交给 hook：`selectedNodes` 每次变都会生成新的 Set，直接进依赖
   * 会让键盘监听跟着反复重挂。
   */
  const selectionRef = useRef<string[]>(selectedNodeIds);
  selectionRef.current = selectedNodeIds;

  useCanvasKeyboard({
    enabled: activeTab === 'personal' && !isSettingsOpen,
    // 网格开着时一按走一格，关着时按 1px 精调；Shift 在此基础上 ×10
    nudgeStep: gridEnabled ? CANVAS_GRID_SIZE : 1,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDeleteSelection: () => void deleteNodes(selectionRef.current),
    onSelectAll: () => setSelectedNodes(new Set(dynamicNodes.map((n) => n.id))),
    onDuplicateSelection: () => void duplicateNodes(selectionRef.current),
    // 拉线/弹层在场时的让位由键盘层机制（services/keyboardLayers）统一处理
    onClearSelection: () => clearSelection(),
    onNudgeSelection: (dx, dy) => void nudgeNodes(selectionRef.current, dx, dy),
    onResetView: () => setCanvasTransform({ x: 0, y: 0, scale: 1 }),
    onZoomToFit: handleZoomToFit,
    onOpenSearch: () => setIsSearchOpen(true),
  });

  /**
   * 沿边重算：改了上游之后，把顺着连线的下游 AI 卡与生图节点按依赖顺序重跑一遍。
   * 这是 Flora / Figma Weave 那类节点画布的核心心智，Spoor 早就有边，缺的只是执行器。
   */
  const { recompute, recomputingNodeIds, isRecomputing } = useCanvasRecompute({
    nodes: dynamicNodes,
    edges,
    regenerateAiNode,
    regenerateImageNode: generateImage,
  });

  const runRecompute = useCallback(
    async (nodeId: string, includeStart: boolean) => {
      const summary = await recompute(nodeId, includeStart);
      // 全跳过时说一声：多半是这些卡片没记下来历（工具栏随手生成的），
      // 静默什么都不发生会让人以为功能坏了
      if (summary.ran === 0 && summary.skipped > 0) {
        await appAlert({ message: t('canvas.recompute_all_skipped', { count: summary.skipped }) });
      }
    },
    [recompute, appAlert, t],
  );

  /**
   * 把一次研究整块落到当前画布：一个区域框圈住题目、计划、论点与结论，
   * 全部连回题目卡，然后切到画布页。
   *
   * 研究结果原先只沉淀成一篇长文——读得了，但接不上后续思考；落成卡片之后
   * 每个论点都能继续连线、追问、被重新分析。
   */
  const spawnResearchToCanvas = useCallback(
    async (session: {
      query: string;
      researchPlan: { title: string; desc: string }[];
      researchReport: { intro: string; points: { title: string; text: string }[]; conclusion: string };
    }) => {
      const at = getCanvasCenterPosition(transformRef.current ?? { x: 0, y: 0, scale: 1 });
      const { nodes, edges: newEdges } = buildResearchFrame({
        canvasId: activeCanvasId,
        at,
        session,
        frameLabel: t('lab.frame_label', { query: session.query }),
        planLabel: t('lab.frame_plan_step'),
        conclusionLabel: t('lab.frame_conclusion'),
      });
      await addNodesAndEdgesRecorded(activeCanvasId, nodes, newEdges);
      setActiveTab('personal');
    },
    [activeCanvasId, transformRef, t],
  );

  /** 中途落卡（C10）：单个已完成的研究步骤落到当前画布中心附近，不切换页签。 */
  const spawnResearchStepToCanvas = useCallback(
    async (step: {
      title: string;
      analysis: string;
      sources: { title: string; link: string; snippet: string }[];
    }) => {
      const at = getCanvasCenterPosition(transformRef.current ?? { x: 0, y: 0, scale: 1 });
      const { nodes, edges: newEdges } = buildResearchStepCards({ canvasId: activeCanvasId, at, step });
      // 整批一步撤销
      await addNodesAndEdgesRecorded(activeCanvasId, nodes, newEdges);
    },
    [activeCanvasId, transformRef],
  );

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

  /**
   * 打标签。弹输入框（逗号分隔），整批写库合并成**一步**撤销。
   * 默认值取第一个节点的现有标签：常见场景是改而不是从零开始敲。
   */
  const setNodeTags = useCallback(
    async (nodeIds: string[]) => {
      const first = await db.nodes.get(nodeIds[0]);
      const input = await appPrompt({
        title: t('canvas.menu.set_tags_title'),
        placeholder: t('canvas.menu.set_tags_placeholder'),
        defaultValue: (first?.tags ?? []).join(', '),
      });
      if (input === null) return;
      const tags = [...new Set(input.split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
      // 每次调用一把新钥匙：同一批合并成一步，两次独立打标不会被误并
      const coalesceKey = `tags:${crypto.randomUUID()}`;
      for (const id of nodeIds) {
        await updateNodeRecorded(
          activeCanvasId,
          id,
          { tags: tags.length > 0 ? tags : undefined },
          { coalesceKey },
        );
      }
    },
    [activeCanvasId, appPrompt, t],
  );

  /**
   * 对齐/分布。高度从 DOM 现量（库里 height 常为空，卡片高度自适应内容），
   * 整批位移合并成一步撤销。
   */
  const alignOrDistributeNodes = useCallback(
    async (nodeIds: string[], op: { align?: AlignMode; distribute?: DistributeAxis }) => {
      const geoms: AlignableNode[] = [];
      for (const id of nodeIds) {
        const node = dynamicNodes.find((n) => n.id === id);
        if (!node) continue;
        const el = nodesRef.current[id];
        geoms.push({
          id,
          x: node.x,
          y: node.y,
          width: node.width ?? el?.offsetWidth ?? 320,
          height: el?.offsetHeight ?? node.height ?? 160,
        });
      }
      const patches = op.align
        ? alignNodes(geoms, op.align)
        : op.distribute
          ? distributeNodes(geoms, op.distribute)
          : [];
      if (patches.length === 0) return;
      const coalesceKey = `align:${crypto.randomUUID()}`;
      for (const p of patches) {
        await updateNodeRecorded(activeCanvasId, p.id, { x: p.x, y: p.y }, { coalesceKey });
      }
    },
    [dynamicNodes, activeCanvasId],
  );

  /** 存为模板：弹名字输入，默认给「模板 N」这种能直接回车的名字。 */
  const saveSelectionAsTemplate = useCallback(
    async (nodeIds: string[]) => {
      const name = await appPrompt({
        title: t('canvas.menu.save_as_template_title'),
        placeholder: t('canvas.menu.save_as_template_placeholder'),
        defaultValue: t('canvas.menu.template_default_name', { count: templates.length + 1 }),
      });
      if (name === null) return;
      const rows = dynamicNodes.filter((n) => nodeIds.includes(n.id));
      await saveCanvasTemplate(name.trim() || `Template ${templates.length + 1}`, rows, edges);
    },
    [appPrompt, t, dynamicNodes, edges, templates.length],
  );

  /** 重命名模板：弹输入框，默认值给旧名，空名/没改就当没发生。 */
  const renameTemplateById = useCallback(
    async (templateId: string) => {
      const row = await db.templates.get(templateId);
      if (!row) return;
      const name = await appPrompt({
        title: t('canvas.menu.rename_template_title'),
        placeholder: t('canvas.menu.rename_template_placeholder'),
        defaultValue: row.name,
      });
      if (name === null) return;
      const trimmed = name.trim();
      if (trimmed === '' || trimmed === row.name) return;
      await db.templates.update(templateId, { name: trimmed });
    },
    [appPrompt, t],
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
      addCanvasLink: (targetCanvasId, at) => void addCanvasLinkNodeAt(targetCanvasId, at),
      pasteNodes: (payload, at) => void pasteClipboardAt(payload, at),
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
      setNodeTags: (nodeIds) => void setNodeTags(nodeIds),
      alignNodes: (nodeIds, mode) => void alignOrDistributeNodes(nodeIds, { align: mode }),
      distributeNodes: (nodeIds, axis) => void alignOrDistributeNodes(nodeIds, { distribute: axis }),
      saveAsTemplate: (nodeIds) => void saveSelectionAsTemplate(nodeIds),
      organizeNodes: (nodeIds) => void runOrganize(nodeIds),
      relayToAgent: (nodeId, agentConfigId) => void relayNodeToAgent(nodeId, agentConfigId),
      startPresentation: (startId, nodeIds) => startPresentation(startId, nodeIds),
      insertTemplate: (templateId, at) => void insertCanvasTemplate(templateId, activeCanvasId, at),
      renameTemplate: (templateId) => void renameTemplateById(templateId),
      deleteTemplate: (templateId) => void deleteCanvasTemplate(templateId),
      outputAsImageNode: (nodeId) => void outputAsImageNode(nodeId),
      recomputeFrom: (nodeId, includeStart) => void runRecompute(nodeId, includeStart),
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
      createNodeAt, insertFilesAt, insertPathsAt, addAgentNodeAt, addCanvasLinkNodeAt, pasteClipboardAt, setCanvasTransform,
      duplicateNode, handleLink, toggleNodeSelection, removeNodeId, deleteEdge,
      linkNodesToHub, handlePublish, clearSelection, deleteNodes, outputAsImageNode,
      saveNodeMediaAsFromCanvas, createNodeAtLinkedFrom, linkNodes, runRecompute, setNodeTags,
      alignOrDistributeNodes, saveSelectionAsTemplate, renameTemplateById, activeCanvasId, runOrganize,
      relayNodeToAgent, startPresentation,
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
    // 落库并记一步撤销。整组拖拽时每张卡各调一次这里，由 moveNodeRecorded 合并成一步。
    void moveNodeRecorded(activeCanvasId, draggedId, { x: finalPos.x, y: finalPos.y });

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
               void addEdgesRecorded(activeCanvasId, [
                 { id: crypto.randomUUID(), canvasId: activeCanvasId, from: agentId, to: contextId },
               ]);
            }
          }
        }
      }
    });
  };

  /**
   * 节点回调的稳定外壳（ref 转发）。`CanvasNodeItem` 是 memo 组件，回调引用一变
   * 就会击穿所有节点的缓存；这里暴露给它的函数引用**终身不变**，调用时现读
   * ref 里挂着的最新实现。往 ref 里塞最新闭包发生在每次渲染，代价可以忽略。
   */
  /** 色板落库：读当前行的外观合并补丁，走可撤销写入。 */
  const applyNodeStyle = (id: string, patch: NonNullable<CanvasNode['styleOverrides']>) => {
    const node = dynamicNodes.find((n) => n.id === id);
    if (!node) return;
    void updateNodeRecorded(activeCanvasId, id, {
      styleOverrides: { ...node.styleOverrides, ...patch },
    });
  };

  const nodeHandlerImpls = {
    handleLink, removeNodeId, toggleNodeSelection, handleNodeDragEnd,
    openNodeContextMenu, runAgentAnalysisFromCard, submitAiThreadFollowUp,
    generateImage, cancelImage, patchImageGenNode, deleteImageResult, setImageActiveIndex,
    setActiveCanvasId, fetchWebNode, extractNoteFrom, setEditingNodeId, activeCanvasId,
    applyNodeStyle,
  };
  const nodeHandlersRef = useRef(nodeHandlerImpls);
  nodeHandlersRef.current = nodeHandlerImpls;

  const nodeShared = React.useMemo<CanvasNodeSharedProps>(() => {
    const h = nodeHandlersRef;
    return {
      nodesRef,
      scaleRef: {
        get current() {
          return transformRef.current?.scale ?? 1;
        },
      },
      onLink: (id) => h.current.handleLink(id),
      onDelete: (id) => h.current.removeNodeId(id),
      onToggleSelect: (id) => h.current.toggleNodeSelection(id),
      onDragEnd: (id, pos) => h.current.handleNodeDragEnd(id, pos),
      onResizeEnd: (id, size) => {
        void resizeNodeRecorded(h.current.activeCanvasId, id, size);
      },
      onStickyActivate: (id) => {
        lastStickyClickIdRef.current = id;
      },
      onContextMenu: (e, id) => h.current.openNodeContextMenu(e, id),
      onStyleChange: (id, patch) => h.current.applyNodeStyle(id, patch),
      setEditingNodeId: (id) => h.current.setEditingNodeId(id),
      onAgentRunAnalysis: (id) => h.current.runAgentAnalysisFromCard(id),
      onAiFollowUp: (id, message) => h.current.submitAiThreadFollowUp(id, message),
      onImageGenGenerate: (id) => void h.current.generateImage(id),
      onImageGenCancel: (id) => void h.current.cancelImage(id),
      onImageGenPatch: (id, patch) => void h.current.patchImageGenNode(id, patch),
      onImageGenDeleteResult: (id, index) => void h.current.deleteImageResult(id, index),
      onImageGenSetActiveIndex: (id, index) => void h.current.setImageActiveIndex(id, index),
      onOpenCanvas: (canvasId) => h.current.setActiveCanvasId(canvasId),
      onWebFetch: (id, url) => void h.current.fetchWebNode(id, url),
      onPdfExtract: (id, text) => void h.current.extractNoteFrom(id, text),
      onPdfPageChange: (id, page, pageCount) => {
        // 读到第几页不是一次编辑，不进撤销栈——Ctrl+Z 应该撤掉的是内容改动，
        // 而不是把人翻回上一页
        void db.nodes.update(id, { pdfPage: page, pdfPageCount: pageCount });
      },
    };
    // transformRef / nodesRef / lastStickyClickIdRef 都是稳定 ref，其余全走 nodeHandlersRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <CanvasHistoryPopover
            canvases={canvases}
            activeCanvasId={activeCanvasId}
            setActiveCanvasId={setActiveCanvasId}
            onExportImage={() => void exportCanvasImage()}
            backlinksByCanvasId={backlinksByCanvasId}
          />

          {isSearchOpen && (
            <CanvasSearchPanel
              query={searchQuery}
              onQueryChange={setSearchQuery}
              matchCount={searchMatches.length}
              activeIndex={searchIndex}
              onStep={(step) =>
                setSearchIndex((prev) => stepSearchIndex(prev, searchMatches.length, step))
              }
              onClose={closeSearch}
              otherCanvases={otherCanvasSearchResults}
              onOpenCanvas={(canvasId) => setActiveCanvasId(canvasId)}
            />
          )}

          {/* Transformed content container */}
          <div className="absolute top-6 right-6 flex items-center z-40 gap-3">
              <Tooltip label={t('canvas.undo')}>
                <button
                  data-canvas-undo=""
                  onClick={handleUndo}
                  disabled={!canUndo || isAnyAiBusy}
                  className="bg-app-surface-raised text-app-text p-3 rounded-full shadow-md hover:scale-105 transition-all border border-app-border flex items-center justify-center hover:border-app-accent hover:text-app-accent disabled:opacity-40 disabled:hover:scale-100 disabled:hover:border-app-border disabled:hover:text-app-text disabled:cursor-not-allowed"
                >
                  <Undo2 className="w-5 h-5" />
                </button>
              </Tooltip>
              <Tooltip label={t('canvas.redo')}>
                <button
                  data-canvas-redo=""
                  onClick={handleRedo}
                  disabled={!canRedo || isAnyAiBusy}
                  className="bg-app-surface-raised text-app-text p-3 rounded-full shadow-md hover:scale-105 transition-all border border-app-border flex items-center justify-center hover:border-app-accent hover:text-app-accent disabled:opacity-40 disabled:hover:scale-100 disabled:hover:border-app-border disabled:hover:text-app-text disabled:cursor-not-allowed"
                >
                  <Redo2 className="w-5 h-5" />
                </button>
              </Tooltip>
              <Tooltip label={t('canvas.full_screen')}>
                <button
                  onClick={toggleFullscreen}
                  className="bg-app-surface-raised text-app-text p-3 rounded-full shadow-md hover:scale-105 transition-all border border-app-border flex items-center justify-center hover:border-app-accent hover:text-app-accent"
                >
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
              </Tooltip>
          </div>

          {/* transform 由 useCanvasInteraction 直写 style（平移/缩放不经过 React），这里不再传 */}
          <div
            ref={contentContainerRef}
            className="absolute inset-0 origin-top-left z-0 pointer-events-none"
          >
            <CanvasEdgeLines
              edges={renderedEdges} connectingFrom={connectingFrom}
              svgRef={svgRef} edgeLabelsRef={edgeLabelsRef}
              hoveredEdgeId={hoveredEdgeId} setHoveredEdgeId={setHoveredEdgeId}
              deleteEdge={deleteEdge}
              onEdgeContextMenu={(e, edgeId) => openContextMenu(e, { kind: 'edge', edgeId })}
            />

            <SnapGuideLines />
            <OrganizePreviewGhosts />
            <div className="absolute inset-0 z-30 w-[1px] h-[1px] pointer-events-none">
              {/* All Nodes from Database（每张卡一个 memo 边界，见 CanvasNodeItem） */}
              {renderedNodes.map((node) => {
                /** 只有经典外壳（layout 0）带手写便签式的轻微倾斜；形态现在来自全局主题。 */
                const rotation =
                  (node.type === 'note' || node.type === 'text') ? (appTheme.noteLayout === 0 ? 1 : 0) :
                  (node.type === 'theme') ? (appTheme.themeLayout === 0 ? -1 : 0) :
                  (node.type === 'image') ? -1 :
                  (node.type === 'video') ? 1 :
                  (node.type === 'document') ? 1 : 0;

                return (
                  <CanvasNodeItem
                    key={node.id}
                    node={node}
                    rotation={rotation}
                    glassSurface={
                      (node.type === 'note' || node.type === 'text') && appTheme.noteLayout === 1
                    }
                    // 区域框永远在所有卡片后面：它是背景，不是卡片
                    zIndexOverride={node.type === 'frame' ? 1 : undefined}
                    isSelected={selectedNodes.has(node.id)}
                    // 区域框拖的是框住的卡片，普通节点拖的是同选区的卡片（见 canvasFrame）
                    selectedIds={groupIdsForDrag(node, dynamicNodes, selectedNodeIds)}
                    isConnecting={connectingFrom !== null}
                    editingNodeId={editingNodeId}
                    analyzingAgentNodeId={analyzingAgentNodeId}
                    followUpParentId={followUpParentId}
                    streamingAiNodeId={streamingAiNodeId}
                    isAnyAiBusy={isAnyAiBusy}
                    agentConfigs={agentConfigs}
                    aiConfig={aiConfigV2}
                    allNodes={dynamicNodes}
                    edges={edges}
                    generatingImageNodeIds={generatingImageNodeIds}
                    fetchingWebNodeIds={fetchingWebNodeIds}
                    canvases={canvases}
                    targetNodeCountByCanvasId={targetNodeCountByCanvasId}
                    presentationCurrentId={
                      presentation.active ? (presentation.order[presentation.index] ?? null) : null
                    }
                    shared={nodeShared}
                  />
                );
              })}
            </div>

          </div>

        <CanvasMinimap
          nodes={dynamicNodes}
          canvasTransform={canvasTransform}
          mainRef={mainRef}
          setCanvasTransform={setCanvasTransform}
        />

        <OrganizePreviewBar
          onApply={() => void applyPendingOrganize()}
          onCancel={cancelPendingOrganize}
        />

        {!isSearchOpen && !presentation.active && (
          <TagFilterBar canvasId={activeCanvasId} nodes={dynamicNodes} />
        )}

        <PresentationHud
          active={presentation.active}
          order={presentation.order}
          index={presentation.index}
          nodes={dynamicNodes}
          onPrev={presentation.prev}
          onNext={presentation.next}
          onJumpTo={presentation.jumpTo}
          onApplyOrder={presentation.reorder}
          onExit={presentation.exit}
        />

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
            canvases={canvases}
            activeCanvasId={activeCanvasId}
            edges={edges}
            isRecomputeDisabled={isAnyAiBusy || isRecomputing}
            templates={templates}
            nodesById={nodesById}
            selectedNodes={selectedNodes}
            actions={contextMenuActions}
            isSynthesizeDisabled={isAnyAiBusy || isOrganizing}
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
        {activeTab === 'lab' && (
          <ResearchLab
            aiConfig={aiConfig}
            callAI={callUniversalAI}
            onSpawnToCanvas={(session) => void spawnResearchToCanvas(session)}
            onSpawnStepToCanvas={(step) => void spawnResearchStepToCanvas(step)}
            initialSessionId={pendingResearchSessionId}
            onInitialSessionConsumed={() => setPendingResearchSessionId(null)}
          />
        )}
        {/* Agents in Agents Studio need consistent write access */}
        {activeTab === 'agents' && <AgentsStudio agentConfigs={agentConfigs} setAgentConfigs={async (newConfigs) => {
          const nextIds = new Set(newConfigs.map((c) => c.id));
          const existing = await db.agents.toArray();
          await Promise.all(existing.filter((row) => !nextIds.has(row.id)).map((row) => db.agents.delete(row.id)));
          await Promise.all(newConfigs.map((config) => db.agents.put(config)));
        }} aiConfig={aiConfig} callAI={callUniversalAI} />}
        <AISettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={aiConfigV2} setConfig={setAiConfigV2} />
        {isGlobalSearchOpen && (
          <GlobalSearchPanel
            canvases={canvases}
            agentNameById={agentNameById}
            onClose={() => setIsGlobalSearchOpen(false)}
            onOpenCanvasNode={(canvasId, nodeId) => {
              setIsGlobalSearchOpen(false);
              setActiveTab('personal');
              if (canvasId === activeCanvasId) {
                focusNode(nodeId);
              } else {
                pendingFocusNodeIdRef.current = nodeId;
                setActiveCanvasId(canvasId);
              }
            }}
            onOpenArticle={(articleId) => {
              setIsGlobalSearchOpen(false);
              setActiveReferenceId(articleId);
              setActiveTab('reference');
            }}
            onOpenResearch={(sessionId) => {
              setIsGlobalSearchOpen(false);
              setPendingResearchSessionId(sessionId);
              setActiveTab('lab');
            }}
          />
        )}
      </div>
    </div>
  );
}
