import { useState, useRef, useEffect, type RefObject } from 'react';

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

export function useCanvasInteraction(
  mainRef: RefObject<HTMLDivElement | null>,
  contentContainerRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  edgeLabelsRef: RefObject<HTMLDivElement | null>,
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
  connectingFrom: string | null,
  setConnectingFrom: (v: string | null) => void,
) {
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Sync ref with state
  useEffect(() => {
    transformRef.current = canvasTransform;
  }, [canvasTransform]);

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  /**
   * 滚轮 = 缩放画布。
   *
   * 例外：指针位于节点内部的可滚动区域（AI 卡正文、文档节点等）且内容尚未滚到边界时，
   * 交给浏览器默认滚动——否则那些卡片里的长文根本没法看。
   */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onWheel = (e: WheelEvent) => {
      let node: HTMLElement | null = e.target as HTMLElement;
      if (node && node.nodeType !== Node.ELEMENT_NODE) {
        node = node.parentElement;
      }
      let insideScrollable = false;
      while (node && main.contains(node) && node !== main) {
        const { overflowY } = window.getComputedStyle(node);
        const canScrollY =
          (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
          node.scrollHeight > node.clientHeight;
        if (canScrollY) {
          insideScrollable = true;
          const dy = e.deltaY;
          const atTop = node.scrollTop <= 0;
          const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
          if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) {
            return;
          }
        }
        node = node.parentElement;
      }
      // 已滚到边界也不接着缩放，避免在卡片里滚动时画布突然跳缩放
      if (insideScrollable) return;

      e.preventDefault();
      setCanvasTransform(prev => {
        const zoomBase = 1.05;
        const factor = e.deltaY < 0 ? zoomBase : 1 / zoomBase;
        const newScale = Math.min(Math.max(0.1, prev.scale * factor), 5);

        const mainRect = main.getBoundingClientRect();
        const clientX = e.clientX - mainRect.left;
        const clientY = e.clientY - mainRect.top;

        // 以指针为锚点缩放：指针下的那一点保持不动
        const mouseXInCanvas = (clientX - prev.x) / prev.scale;
        const mouseYInCanvas = (clientY - prev.y) / prev.scale;

        return {
          x: clientX - mouseXInCanvas * newScale,
          y: clientY - mouseYInCanvas * newScale,
          scale: newScale,
        };
      });
    };
    main.addEventListener('wheel', onWheel, { passive: false });
    return () => main.removeEventListener('wheel', onWheel);
  }, [mainRef]);

  /**
   * 平移画布 = 按住**中键**拖动。
   *
   * 左键留给框选、右键留给上下文菜单，所以这里只认 button 1。
   * `preventDefault` 用来压掉 Windows 上中键的自动滚动。
   */
  const handlePanStart = (e: React.PointerEvent) => {
    if (e.button !== 1) return;
    if (connectingFrom) setConnectingFrom(null);
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startTransform = transformRef.current;

    const onPointerMove = (moveEv: PointerEvent) => {
      setCanvasTransform({
        ...startTransform,
        x: startTransform.x + (moveEv.clientX - startX),
        y: startTransform.y + (moveEv.clientY - startY),
      });
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Edge line animation loop
  useEffect(() => {
    let animationFrameId: number;
    const updateLines = () => {
      const svg = svgRef.current;
      const container = contentContainerRef.current;
      const edgeLabelsContainer = edgeLabelsRef.current;

      // Always reschedule: after HMR or strict-mode remount, refs can be null for a frame.
      // Early-return without rAF would permanently stop edge updates until a full reload.
      if (svg && container) {
        const containerRect = container.getBoundingClientRect();
        const currentScale = transformRef.current.scale;

        const edgeGroups = Array.from(svg.querySelectorAll('g[data-edge-id]')) as SVGGElement[];

        edgeGroups.forEach((g: SVGGElement) => {
          const fromId = g.getAttribute('data-edge-from');
          const toId = g.getAttribute('data-edge-to');
          const edgeId = g.getAttribute('data-edge-id');
          if (!fromId || !toId || !edgeId) return;

          const fromNode = nodesRef.current[fromId];
          const toNode = nodesRef.current[toId];
          if (fromNode && toNode) {
            const fromRect = fromNode.getBoundingClientRect();
            const toRect = toNode.getBoundingClientRect();

            const x1 = (fromRect.left + fromRect.width / 2 - containerRect.left) / currentScale;
            const y1 = (fromRect.top + fromRect.height / 2 - containerRect.top) / currentScale;
            const x2 = (toRect.left + toRect.width / 2 - containerRect.left) / currentScale;
            const y2 = (toRect.top + toRect.height / 2 - containerRect.top) / currentScale;

            g.querySelectorAll('line').forEach((line: SVGLineElement) => {
              line.setAttribute('x1', x1.toString());
              line.setAttribute('y1', y1.toString());
              line.setAttribute('x2', x2.toString());
              line.setAttribute('y2', y2.toString());
            });

            if (edgeLabelsContainer) {
              const btn = edgeLabelsContainer.querySelector(`[data-edge-btn="${edgeId}"]`) as HTMLButtonElement;
              if (btn) {
                btn.style.left = `${(x1 + x2) / 2}px`;
                btn.style.top = `${(y1 + y2) / 2}px`;
              }
            }
          }
        });

        const tempEdge = svg.querySelector('#temp-edge') as SVGLineElement;
        const connFrom = svg.getAttribute('data-connecting-from');
        if (tempEdge) {
          if (connFrom && nodesRef.current[connFrom]) {
            const fromNode = nodesRef.current[connFrom];
            const fromRect = fromNode.getBoundingClientRect();

            const x1 = (fromRect.right - containerRect.left) / currentScale;
            const y1 = (fromRect.top + fromRect.height / 2 - containerRect.top) / currentScale;
            const x2 = (mousePosRef.current.x - containerRect.left) / currentScale;
            const y2 = (mousePosRef.current.y - containerRect.top) / currentScale;

            tempEdge.style.display = 'block';
            tempEdge.setAttribute('x1', x1.toString());
            tempEdge.setAttribute('y1', y1.toString());
            tempEdge.setAttribute('x2', x2.toString());
            tempEdge.setAttribute('y2', y2.toString());
          } else {
            tempEdge.style.display = 'none';
          }
        }
      }

      animationFrameId = requestAnimationFrame(updateLines);
    };
    updateLines();
    return () => cancelAnimationFrame(animationFrameId);
  }, [svgRef, contentContainerRef, edgeLabelsRef, nodesRef]);

  return { canvasTransform, setCanvasTransform, transformRef, handlePanStart, mousePosRef };
}
