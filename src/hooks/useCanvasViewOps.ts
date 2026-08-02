import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { Canvas, CanvasNode, Edge } from '../db';
import type { AppAlertOptions } from '../components/AppDialogProvider';
import type { CanvasViewTransform } from '../utils/canvas';
import { markEdgesDirty } from '../services/edgeGeometry';
import { visibleNodeIds } from '../utils/viewportCulling';
import {
  computeCenterTransform,
  computeFitTransform,
  unionNodeBoundsInCanvasSpace,
} from '../utils/zoomToFit';
import {
  CanvasImageExportError,
  renderCanvasImage,
  saveCanvasImage,
} from '../services/canvasImageExport';
import { toSafeFileName } from '../services/canvasPortability';

/**
 * 画布的「视口活」，从 App 整体搬出（0.5.0 拆薄）：视口裁剪、缩放至适应内容、
 * 聚焦单卡、整图导出。共同点是全都要摸 DOM（refs + transform 量包围盒），
 * 与 App 里的数据编排无关。
 */
export interface UseCanvasViewOpsParams {
  mainRef: RefObject<HTMLDivElement | null>;
  contentContainerRef: RefObject<HTMLDivElement | null>;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  transformRef: RefObject<CanvasViewTransform>;
  setCanvasTransform: (next: CanvasViewTransform) => void;
  canvasTransform: CanvasViewTransform;
  /** ResizeObserver 只在画布页挂着（页签切走时 mainRef 会换/卸载）。 */
  activeTab: string;
  dynamicNodes: CanvasNode[];
  edges: Edge[];
  canvases: Canvas[];
  activeCanvasId: string;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  appAlert: (options: AppAlertOptions) => Promise<void>;
  t: TFunction;
}

export function useCanvasViewOps({
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
}: UseCanvasViewOpsParams) {
  /**
   * 视口裁剪。
   *
   * 卡片超过阈值时只渲染看得见的那些（与可见节点相连的也留着，否则连线会整根消失）。
   * 导出与「缩放至适应内容」要量全部内容的包围盒，靠 `withAllNodesRendered` 临时关掉它。
   *
   * 视口尺寸从 DOM 现取、以 transform 为依赖：平移缩放都会重算。窗口缩放而不平移的
   * 极端情况下会短暂失准，下一次平移即自愈——不值得为它再挂一个 resize 监听。
   */
  const [renderAllNodes, setRenderAllNodes] = useState(false);

  /** 窗口缩放会改视口尺寸，裁剪集合与连线几何都要跟着重算。 */
  const [viewportVersion, setViewportVersion] = useState(0);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setViewportVersion((v) => v + 1);
      markEdgesDirty();
    });
    ro.observe(main);
    return () => ro.disconnect();
    // mainRef 是稳定 ref；activeTab 变化时画布 DOM 会重挂，要重新 observe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /** 节点/连线增删改（含撤销重做）后连线要重画。 */
  useEffect(() => {
    markEdgesDirty();
  }, [dynamicNodes, edges]);

  const culledNodeIds = useMemo(() => {
    if (renderAllNodes) return null;
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return visibleNodeIds(
      dynamicNodes,
      edges,
      { width: rect.width, height: rect.height },
      canvasTransform,
    );
    // viewportVersion 只为让窗口缩放触发重算，不参与计算本身
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderAllNodes, dynamicNodes, edges, canvasTransform, viewportVersion]);

  const renderedNodes = useMemo(
    () => (culledNodeIds ? dynamicNodes.filter((n) => culledNodeIds.has(n.id)) : dynamicNodes),
    [culledNodeIds, dynamicNodes],
  );

  /**
   * 边也随裁剪走：两端都不在可见集合里的边整条不渲染。
   * 可见集合已把"与可见节点相连的节点"包含进来（见 visibleNodeIds），
   * 所以任何有一端可见的边，两端都在集合里——这里的过滤不会误伤半可见的边。
   */
  const renderedEdges = useMemo(
    () =>
      culledNodeIds
        ? edges.filter((e) => culledNodeIds.has(e.from) && culledNodeIds.has(e.to))
        : edges,
    [culledNodeIds, edges],
  );

  /**
   * 临时全量渲染，跑完再恢复。
   *
   * 导出图片与缩放至适应内容都靠 DOM 量包围盒，裁剪开着的话它们只能看到当前屏幕这一块。
   * 等两帧是为了让 React 提交完这次渲染——只等一帧时 DOM 还没落地。
   */
  const withAllNodesRendered = useCallback(
    async <T,>(fn: () => T | Promise<T>): Promise<T> => {
      if (!culledNodeIds) return fn();
      setRenderAllNodes(true);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      );
      try {
        return await fn();
      } finally {
        setRenderAllNodes(false);
      }
    },
    [culledNodeIds],
  );

  /** 缩放至适应全部内容：把所有节点的包围盒装进视口。 */
  const handleZoomToFit = useCallback(() => {
    // 裁剪开着时先把全部节点渲染出来，否则量到的只是当前屏幕这一块
    void withAllNodesRendered(() => {
      const main = mainRef.current;
      if (!main) return;
      const containerRect = main.getBoundingClientRect();
      const bounds = unionNodeBoundsInCanvasSpace(
        Object.values(nodesRef.current ?? {}),
        containerRect,
        transformRef.current ?? { x: 0, y: 0, scale: 1 },
      );
      if (!bounds) return;
      setCanvasTransform(
        computeFitTransform(bounds, { width: containerRect.width, height: containerRect.height }),
      );
    });
  }, [mainRef, nodesRef, transformRef, setCanvasTransform, withAllNodesRendered]);

  /** 把某张卡片移到视口正中并选中它。缩放保持不变（见 computeCenterTransform）。 */
  const focusNode = useCallback(
    (nodeId: string) => {
      const main = mainRef.current;
      if (!main) return;
      const rect = main.getBoundingClientRect();
      const transform = transformRef.current ?? { x: 0, y: 0, scale: 1 };
      const el = nodesRef.current?.[nodeId];
      const bounds = el
        ? unionNodeBoundsInCanvasSpace([el], rect, transform)
        : null;
      if (!bounds) return;
      setCanvasTransform(
        computeCenterTransform(bounds, { width: rect.width, height: rect.height }, transform.scale),
      );
      setSelectedNodes(new Set([nodeId]));
    },
    [mainRef, nodesRef, transformRef, setCanvasTransform, setSelectedNodes],
  );

  /**
   * 把整张画布导出成 PNG。
   *
   * 要摸 DOM：导的是**全部内容**而非当前视口，
   * 得先量出所有卡片的包围盒（见 `services/canvasImageExport`）。
   */
  const exportCanvasImage = useCallback(async () => {
    const main = mainRef.current;
    const content = contentContainerRef.current;
    if (!main || !content) return;

    const canvasName = canvases.find((c) => c.id === activeCanvasId)?.name ?? activeCanvasId;
    try {
      // 同上：导的是整张画布，裁剪期间必须先把全部节点渲染出来
      const dataUrl = await withAllNodesRendered(() =>
        renderCanvasImage({
          contentContainer: content,
          viewport: main,
          transform: transformRef.current ?? { x: 0, y: 0, scale: 1 },
          nodeElements: Object.values(nodesRef.current ?? {}),
          format: 'png',
          // 底色跟着当前主题走，导出的图才和屏幕上看到的是同一张
          backgroundColor: getComputedStyle(main).backgroundColor || '#ffffff',
        }),
      );
      await saveCanvasImage(`${toSafeFileName(canvasName)}.png`, dataUrl);
    } catch (e) {
      const code = e instanceof CanvasImageExportError ? e.code : 'render_failed';
      await appAlert({ message: t(`canvas.export_image_${code}`) });
    }
  }, [
    mainRef, contentContainerRef, nodesRef, transformRef,
    activeCanvasId, canvases, appAlert, t, withAllNodesRendered,
  ]);

  return {
    renderedNodes,
    renderedEdges,
    withAllNodesRendered,
    handleZoomToFit,
    focusNode,
    exportCanvasImage,
  };
}
