import type { RefObject } from 'react';
import type { CanvasTransform } from './useCanvasInteraction';
import { db, type CanvasNode } from '../db';
import i18n from '../i18n';
import { getCanvasCenterPosition } from '../utils/canvas';
import { readFileContent } from '../utils/file';
import { importFileToNodeData, importPathToNodeData } from '../services/fileImport';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import {
  materializeCanvasClipboard,
  type CanvasClipboardPayloadV2,
} from '../utils/canvasClipboard';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH } from '../services/canvasFrame';
import {
  addEdgesRecorded,
  addNodesAndEdgesRecorded,
  addNodesRecorded,
  deleteEdgeRecorded,
  deleteNodesRecorded,
  moveNodeRecorded,
  recordAddedNodes,
} from '../services/canvasMutations';

export interface CanvasPoint {
  x: number;
  y: number;
}

/** 同一次插入多个文件时，逐个错开一点，避免完全重叠。 */
const MULTI_INSERT_STAGGER = 20;
/** 主题卡以外的版式轮换档数（见 `nodeCapabilities` 注释）。 */

interface UseNodeActionsParams {
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  connectingFrom: string | null;
  setConnectingFrom: (v: string | null) => void;
  edges: { from: string; to: string }[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  transformRef: RefObject<CanvasTransform>;
}

export function useNodeActions({
  activeCanvasId,
  nodesRef,
  connectingFrom,
  setConnectingFrom,
  edges,
  selectedNodes,
  setSelectedNodes,
  transformRef,
}: UseNodeActionsParams) {
  /** 未指定落点时沿用「视口中心 + 抖动」，供工具栏按钮使用。 */
  const resolvePosition = (at?: CanvasPoint): CanvasPoint =>
    at ?? getCanvasCenterPosition(transformRef.current ?? { x: 0, y: 0, scale: 1 });

  const toggleNodeSelection = (id: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLink = (id: string) => {
    if (connectingFrom) {
      if (connectingFrom !== id && !edges.find(e => (e.from === connectingFrom && e.to === id) || (e.from === id && e.to === connectingFrom))) {
        void addEdgesRecorded(activeCanvasId, [
          { id: crypto.randomUUID(), canvasId: activeCanvasId, from: connectingFrom, to: id },
        ]);
      }
      setConnectingFrom(null);
    } else {
      setConnectingFrom(id);
    }
  };

  const deleteEdge = (id: string) => {
    void deleteEdgeRecorded(activeCanvasId, id);
  };

  const removeNodeId = (id: string) => {
    void deleteNodesRecorded(activeCanvasId, [id]);
    setSelectedNodes(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedNodes(new Set());

  /** 批量删除节点及其全部关联边。 */
  const deleteNodes = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    await deleteNodesRecorded(activeCanvasId, ids);
    setSelectedNodes((prev) => {
      const next = new Set([...prev].filter((id) => !idSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  };

  /**
   * 星型连线：把 `nodeIds` 里除 `hubId` 以外的节点全部连到 `hubId`。
   * 已存在的边（任一方向）跳过，重复执行不会产生重复连线。
   */
  const linkNodesToHub = async (nodeIds: string[], hubId: string) => {
    const others = new Set(nodeIds.filter((id) => id !== hubId));
    if (others.size === 0) return;

    const existing = await db.edges
      .filter((e) => (e.from === hubId && others.has(e.to)) || (e.to === hubId && others.has(e.from)))
      .toArray();
    const alreadyLinked = new Set(existing.map((e) => (e.from === hubId ? e.to : e.from)));

    const rows = [...others]
      .filter((id) => !alreadyLinked.has(id))
      .map((id) => ({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: hubId, to: id }));
    await addEdgesRecorded(activeCanvasId, rows);
  };

  const addTextNode = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      { id, canvasId: activeCanvasId, type: 'text', content: '', x, y },
    ]);
    return id;
  };

  const addThemeNode = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      {
        id,
        canvasId: activeCanvasId,
        type: 'theme',
        content: i18n.t('nodes.new_theme_title'),
        x,
        y,
      },
    ]);
    return id;
  };

  /** 生图节点：建出来是空的，连上图片/文本或直接填提示词后再生成。 */
  const addImageGenNode = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      {
        id,
        canvasId: activeCanvasId,
        type: 'imagegen',
        x,
        y,
        width: 340,
      },
    ]);
    return id;
  };

  /**
   * 网页卡片。`url` 留空时卡片本身就是输入框；给了地址就由调用方接着触发抓取。
   */
  const addWebNodeAt = async (at?: CanvasPoint, url?: string) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      { id, canvasId: activeCanvasId, type: 'web', url, x, y, width: 320 },
    ]);
    return id;
  };

  /**
   * 从某张卡片里摘一段出来，变成旁边一张便签，并连一条边回去。
   *
   * PDF 摘录用它。**连线不是装饰**：三个月后想弄清"这句话是从哪来的"，
   * 靠的就是这条线。因此便签与连线记成同一步撤销——撤销一次应该两个都没了。
   */
  const extractNoteFrom = async (sourceNodeId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const source = await db.nodes.get(sourceNodeId);
    if (!source) return null;

    const noteId = crypto.randomUUID();
    const [created] = await addNodesAndEdgesRecorded(
      activeCanvasId,
      [
        {
          id: noteId,
          canvasId: activeCanvasId,
          type: 'text',
          content: trimmed,
          x: source.x + (source.width ?? 320) + 60,
          y: source.y,
          width: 300,
        },
      ],
      [{ id: crypto.randomUUID(), canvasId: activeCanvasId, from: sourceNodeId, to: noteId }],
    );
    return created ?? null;
  };

  /** 区域框：一个圈范围的矩形，落点为左上角。 */
  const addFrameNodeAt = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      {
        id,
        canvasId: activeCanvasId,
        type: 'frame',
        content: '',
        x,
        y,
        width: DEFAULT_FRAME_WIDTH,
        height: DEFAULT_FRAME_HEIGHT,
      },
    ]);
    return id;
  };

  /** 跨画布传送门：一张指向另一张画布的卡片。 */
  const addCanvasLinkNodeAt = async (targetCanvasId: string, at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    const id = crypto.randomUUID();
    await addNodesRecorded(activeCanvasId, [
      { id, canvasId: activeCanvasId, type: 'canvasLink', targetCanvasId, x, y, width: 260 },
    ]);
    return id;
  };

  /** 供右键菜单按 `CanvasCreateItemDef.nodeType` 统一分发。返回新节点 id。 */
  const createNodeAt = async (
    nodeType: 'text' | 'theme' | 'imagegen' | 'web' | 'frame',
    at?: CanvasPoint,
  ) => {
    if (nodeType === 'theme') return addThemeNode(at);
    if (nodeType === 'imagegen') return addImageGenNode(at);
    if (nodeType === 'web') return addWebNodeAt(at);
    if (nodeType === 'frame') return addFrameNodeAt(at);
    return addTextNode(at);
  };

  /** 从 `fromId` 连一条边到 `toId`；已存在同一对端点的边时跳过。 */
  const linkNodes = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const exists = await db.edges
      .filter((e) => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))
      .first();
    if (exists) return;
    await addEdgesRecorded(activeCanvasId, [
      { id: crypto.randomUUID(), canvasId: activeCanvasId, from: fromId, to: toId },
    ]);
  };

  /**
   * 连线拖到空白处后选了「新建 X」：建卡并立刻把线接上。
   *
   * 这样一次拖拽就完成「我想从这里引出一个新想法」，而不是先取消连线、
   * 再右键建卡、再重新连一次。
   */
  const createNodeAtLinkedFrom = async (
    nodeType: 'text' | 'theme' | 'imagegen' | 'web' | 'frame',
    at: CanvasPoint,
    fromId: string,
  ) => {
    const newId = await createNodeAt(nodeType, at);
    if (newId) await linkNodes(fromId, newId);
    return newId;
  };

  const addAgentNodeAt = async (agentConfigId: string, at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    await addNodesRecorded(activeCanvasId, [
      {
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        type: 'agent',
        agentConfigId,
        x,
        y,
      },
    ]);
  };

  /**
   * 桌面端：原件归档到文件存储，节点只记相对路径。
   * 浏览器（`npm run dev` 调试）：没有文件存储可用，退回旧的 data URL，
   * 渲染层的 `filePath > content` 兜底会照常显示。
   */
  const buildNodeDataForFile = async (file: File) => {
    if (isTauriRuntime()) {
      return importFileToNodeData(file, i18n.t('nodes.empty_document_body'));
    }
    return readFileContent(file);
  };

  /** 落库多个文件，首个放在 `at`，其余依次错开。 */
  const insertFilesAt = async (files: File[], at?: CanvasPoint) => {
    const created: string[] = [];
    if (files.length === 0) return created;
    const origin = resolvePosition(at);
    // 逐个落库让卡片挨个出现，最后整批补记一步撤销（见 recordAddedNodes 注释）
    const rows: CanvasNode[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try {
        const data = await buildNodeDataForFile(file);
        const row: CanvasNode = {
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          ...data,
          x: origin.x + index * MULTI_INSERT_STAGGER,
          y: origin.y + index * MULTI_INSERT_STAGGER,
        };
        await db.nodes.add(row);
        rows.push(row);
        created.push(row.id);
      } catch (err) {
        console.error('Failed to process file:', file.name, err);
      }
    }
    recordAddedNodes(activeCanvasId, rows);
    return created;
  };

  /**
   * 从原生绝对路径落库（文件对话框给的）。
   *
   * 与 `insertFilesAt` 的区别只在源：这条路上文件字节完全不进 JS，
   * Rust 直接 `fs::copy`，插一个 500MB 的视频也不会卡住界面。
   */
  const insertPathsAt = async (paths: string[], at?: CanvasPoint) => {
    const created: string[] = [];
    if (paths.length === 0) return created;
    const origin = resolvePosition(at);
    const rows: CanvasNode[] = [];
    for (let index = 0; index < paths.length; index++) {
      try {
        const data = await importPathToNodeData(paths[index], i18n.t('nodes.empty_document_body'));
        const row: CanvasNode = {
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          ...data,
          x: origin.x + index * MULTI_INSERT_STAGGER,
          y: origin.y + index * MULTI_INSERT_STAGGER,
        };
        await db.nodes.add(row);
        rows.push(row);
        created.push(row.id);
      } catch (err) {
        console.error('Failed to import file:', paths[index], err);
      }
    }
    recordAddedNodes(activeCanvasId, rows);
    return created;
  };

  /** 复制一个节点的全部内容到旁边（不复制它的连线）。 */
  const duplicateNode = async (id: string) => {
    const node = await db.nodes.get(id);
    if (!node) return;
    const { id: _omit, ...rest } = node;
    await addNodesRecorded(activeCanvasId, [
      {
        ...rest,
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        x: node.x + MULTI_INSERT_STAGGER,
        y: node.y + MULTI_INSERT_STAGGER,
      },
    ]);
  };

  /**
   * 批量复制：整个选区一起偏移一点复制出来，算**一步**撤销。
   *
   * 不复用 `duplicateNode` 循环调用——那样复制五张卡要按五次 Ctrl+Z 才撤干净。
   * 与单节点复制一样不带连线：复制出来的卡片之间该不该连，用户自己说了算。
   */
  const duplicateNodes = async (ids: string[]) => {
    if (ids.length === 0) return [];
    const rows = await db.nodes.bulkGet(ids);
    const copies: CanvasNode[] = [];
    for (const node of rows) {
      if (!node) continue;
      const { id: _omit, ...rest } = node;
      copies.push({
        ...rest,
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        x: node.x + MULTI_INSERT_STAGGER,
        y: node.y + MULTI_INSERT_STAGGER,
      });
    }
    return addNodesRecorded(activeCanvasId, copies);
  };

  /**
   * 方向键微调：把选区整体平移 `(dx, dy)`。
   *
   * 每张卡各写一次库，但它们都落在同一个合并窗口里，因此长按方向键连续走一路
   * 也只占一步撤销（见 `canvasHistory` 的合并规则）。
   */
  const nudgeNodes = async (ids: string[], dx: number, dy: number) => {
    if (ids.length === 0 || (dx === 0 && dy === 0)) return;
    const rows = await db.nodes.bulkGet(ids);
    for (const node of rows) {
      if (!node) continue;
      await moveNodeRecorded(activeCanvasId, node.id, { x: node.x + dx, y: node.y + dy });
    }
  };

  /** 按剪贴板负载建节点与其间的连线；保留多张之间的相对位置，整体落到 `at`。 */
  const pasteClipboardAt = async (payload: CanvasClipboardPayloadV2, at?: CanvasPoint) => {
    if (payload.nodes.length === 0) return [];
    const origin = resolvePosition(at);
    const { nodes, edges } = materializeCanvasClipboard(payload, activeCanvasId, origin);
    return addNodesAndEdgesRecorded(activeCanvasId, nodes, edges);
  };

  return {
    toggleNodeSelection,
    handleLink,
    deleteEdge,
    removeNodeId,
    addTextNode,
    addThemeNode,
    addImageGenNode,
    createNodeAt,
    createNodeAtLinkedFrom,
    linkNodes,
    addAgentNodeAt,
    addCanvasLinkNodeAt,
    addWebNodeAt,
    addFrameNodeAt,
    extractNoteFrom,
    insertFilesAt,
    insertPathsAt,
    duplicateNode,
    duplicateNodes,
    nudgeNodes,
    pasteClipboardAt,
    clearSelection,
    deleteNodes,
    linkNodesToHub,
  };
}
