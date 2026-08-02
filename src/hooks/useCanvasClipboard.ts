import { useEffect, useRef, type RefObject } from 'react';
import type { CanvasNode, Edge } from '../db';
import {
  buildCanvasClipboardPayload,
  materializeCanvasClipboard,
  parseCanvasClipboardPayload,
} from '../utils/canvasClipboard';
import { addNodesAndEdgesRecorded } from '../services/canvasMutations';
import { isTextEditingTarget } from '../utils/noteClipboard';
import { isFetchableUrl } from '../services/webPage';

/**
 * Ctrl+C / Ctrl+X / Ctrl+V（从 App 抽出来的画布剪贴板，0.3.x 里这段住在 App 本体）。
 *
 * 复制的对象是**当前选区**；选区为空时退回到最后点过的那张便签，保留 v0.2 的手感
 * （随手点一张卡就能复制，不必先勾选）。负载走系统剪贴板的纯文本通道，因此可以
 * 在两个 Spoor 窗口之间、甚至粘进编辑器看一眼。
 *
 * 数据依赖全部走 ref：监听器挂一次就不动，不随每次选区/节点变化重挂。
 */
export function useCanvasClipboard(params: {
  /** 只在画布页生效。 */
  enabled: boolean;
  dynamicNodes: CanvasNode[];
  edges: Edge[];
  activeCanvasId: string;
  selectedNodeIds: string[];
  /** 选区为空时的复制兜底：最后点过的便签。 */
  lastStickyClickIdRef: RefObject<string | null>;
  /** 删除与建网页卡的实现住在 useNodeActions（在调用方晚于本 hook 初始化），用 ref 转接。 */
  deleteNodesRef: RefObject<(ids: string[]) => Promise<void>>;
  createWebNodeRef: RefObject<(url: string, at?: { x: number; y: number }) => Promise<string>>;
  setSelectedNodes: (next: Set<string>) => void;
}): void {
  const {
    enabled,
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodeIds,
    lastStickyClickIdRef,
    deleteNodesRef,
    createWebNodeRef,
    setSelectedNodes,
  } = params;

  const contextRef = useRef({ dynamicNodes, edges, activeCanvasId, selectedNodeIds });
  contextRef.current = { dynamicNodes, edges, activeCanvasId, selectedNodeIds };
  const setSelectedNodesRef = useRef(setSelectedNodes);
  setSelectedNodesRef.current = setSelectedNodes;

  useEffect(() => {
    if (!enabled) return;

    const collectNodesToCopy = (): CanvasNode[] => {
      const { dynamicNodes: nodes, selectedNodeIds: selection } = contextRef.current;
      if (selection.length > 0) {
        const picked = new Set(selection);
        return nodes.filter((n) => picked.has(n.id));
      }
      const focusId = lastStickyClickIdRef.current;
      if (!focusId) return [];
      return nodes.filter((n) => n.id === focusId);
    };

    const writePayload = (e: ClipboardEvent): CanvasNode[] => {
      const picked = collectNodesToCopy();
      const payload = buildCanvasClipboardPayload(picked, contextRef.current.edges);
      if (!payload) return [];
      e.preventDefault();
      e.clipboardData?.setData('text/plain', JSON.stringify(payload));
      return picked;
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      writePayload(e);
    };

    const onCut = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const picked = writePayload(e);
      if (picked.length === 0) return;
      void deleteNodesRef.current(picked.map((n) => n.id));
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';

      // 粘贴的是一条干净的链接：直接落成网页卡片并开抓（Kosmik 的手感）
      if (isFetchableUrl(text)) {
        e.preventDefault();
        void createWebNodeRef.current(text.trim());
        return;
      }

      const payload = parseCanvasClipboardPayload(text);
      if (!payload) return;
      e.preventDefault();
      const { activeCanvasId: canvasId } = contextRef.current;
      void (async () => {
        // 不传落点：副本压着原件偏一点出现，用户一眼知道粘出来的是哪几张
        const { nodes, edges: pastedEdges } = materializeCanvasClipboard(payload, canvasId);
        const createdIds = await addNodesAndEdgesRecorded(canvasId, nodes, pastedEdges);
        // 选中刚粘出来的这批：接着拖走或再按一次 Ctrl+V 都顺手
        setSelectedNodesRef.current(new Set(createdIds));
      })();
    };

    window.addEventListener('copy', onCopy, true);
    window.addEventListener('cut', onCut, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('cut', onCut, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [enabled, lastStickyClickIdRef, deleteNodesRef, createWebNodeRef]);
}
