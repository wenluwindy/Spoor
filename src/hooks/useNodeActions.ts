import type { RefObject } from 'react';
import type { CanvasTransform } from './useCanvasInteraction';
import { db, type CanvasNode } from '../db';
import i18n from '../i18n';
import { getCanvasCenterPosition } from '../utils/canvas';
import { readFileContent } from '../utils/file';
import { importFileToNodeData, importPathToNodeData } from '../services/fileImport';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { nodeSupportsCycleLayout } from '../constants/nodeCapabilities';
import { NOTE_LAYOUT_COUNT } from '../constants/noteLayouts';
import { isStickyNoteType, type StickyClipboardPayloadV1 } from '../utils/noteClipboard';

export interface CanvasPoint {
  x: number;
  y: number;
}

/** 同一次插入多个文件时，逐个错开一点，避免完全重叠。 */
const MULTI_INSERT_STAGGER = 20;
/** 主题卡以外的版式轮换档数（见 `nodeCapabilities` 注释）。 */
const THEME_LAYOUT_COUNT = 4;

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
        db.edges.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: connectingFrom, to: id });
      }
      setConnectingFrom(null);
    } else {
      setConnectingFrom(id);
    }
  };

  const deleteEdge = (id: string) => {
    db.edges.delete(id);
  };

  const removeNodeId = (id: string) => {
    db.nodes.delete(id);
    db.edges.where('from').equals(id).or('to').equals(id).delete();
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
    await db.nodes.bulkDelete(ids);
    const related = await db.edges.filter((e) => idSet.has(e.from) || idSet.has(e.to)).toArray();
    if (related.length > 0) await db.edges.bulkDelete(related.map((e) => e.id));
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
    if (rows.length > 0) await db.edges.bulkAdd(rows);
  };

  const addTextNode = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    await db.nodes.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, type: 'text', content: '', x, y });
  };

  const addThemeNode = async (at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    await db.nodes.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      type: 'theme',
      content: i18n.t('nodes.new_theme_title'),
      x,
      y,
    });
  };

  /** 供右键菜单按 `CanvasCreateItemDef.nodeType` 统一分发。 */
  const createNodeAt = async (nodeType: 'text' | 'theme', at?: CanvasPoint) => {
    if (nodeType === 'theme') await addThemeNode(at);
    else await addTextNode(at);
  };

  const addAgentNodeAt = async (agentConfigId: string, at?: CanvasPoint) => {
    const { x, y } = resolvePosition(at);
    await db.nodes.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      type: 'agent',
      agentConfigId,
      x,
      y,
    });
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
    if (files.length === 0) return;
    const origin = resolvePosition(at);
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try {
        const data = await buildNodeDataForFile(file);
        await db.nodes.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          ...data,
          x: origin.x + index * MULTI_INSERT_STAGGER,
          y: origin.y + index * MULTI_INSERT_STAGGER,
        });
      } catch (err) {
        console.error('Failed to process file:', file.name, err);
      }
    }
  };

  /**
   * 从原生绝对路径落库（文件对话框给的）。
   *
   * 与 `insertFilesAt` 的区别只在源：这条路上文件字节完全不进 JS，
   * Rust 直接 `fs::copy`，插一个 500MB 的视频也不会卡住界面。
   */
  const insertPathsAt = async (paths: string[], at?: CanvasPoint) => {
    if (paths.length === 0) return;
    const origin = resolvePosition(at);
    for (let index = 0; index < paths.length; index++) {
      try {
        const data = await importPathToNodeData(paths[index], i18n.t('nodes.empty_document_body'));
        await db.nodes.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          ...data,
          x: origin.x + index * MULTI_INSERT_STAGGER,
          y: origin.y + index * MULTI_INSERT_STAGGER,
        });
      } catch (err) {
        console.error('Failed to import file:', paths[index], err);
      }
    }
  };

  /** 复制一个节点的全部内容到旁边（不复制它的连线）。 */
  const duplicateNode = async (id: string) => {
    const node = await db.nodes.get(id);
    if (!node) return;
    const { id: _omit, ...rest } = node;
    await db.nodes.add({
      ...rest,
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      x: node.x + MULTI_INSERT_STAGGER,
      y: node.y + MULTI_INSERT_STAGGER,
    });
  };

  const cycleNodeLayout = async (id: string) => {
    const node = await db.nodes.get(id);
    if (!node || !nodeSupportsCycleLayout(node.type)) return;
    const cycleMod = isStickyNoteType(node.type) ? NOTE_LAYOUT_COUNT : THEME_LAYOUT_COUNT;
    await db.nodes.update(id, { layout: ((node.layout ?? 0) + 1) % cycleMod });
  };

  /** 按剪贴板负载建便签；保留多张之间的相对位置，整体落到 `at`。 */
  const pasteStickyAt = async (payload: StickyClipboardPayloadV1, at?: CanvasPoint) => {
    if (payload.nodes.length === 0) return;
    const origin = resolvePosition(at);
    const baseX = Math.min(...payload.nodes.map((n) => n.x));
    const baseY = Math.min(...payload.nodes.map((n) => n.y));
    const rows: CanvasNode[] = payload.nodes.map((item) => ({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      type: item.type,
      content: item.content ?? '',
      layout: item.layout,
      width: item.width,
      height: item.height,
      x: origin.x + (item.x - baseX),
      y: origin.y + (item.y - baseY),
    }));
    await db.nodes.bulkAdd(rows);
  };

  return {
    toggleNodeSelection,
    handleLink,
    deleteEdge,
    removeNodeId,
    addTextNode,
    addThemeNode,
    createNodeAt,
    addAgentNodeAt,
    insertFilesAt,
    insertPathsAt,
    duplicateNode,
    cycleNodeLayout,
    pasteStickyAt,
    clearSelection,
    deleteNodes,
    linkNodesToHub,
  };
}
