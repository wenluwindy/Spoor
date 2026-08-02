import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { buildEdgePath, edgeMidpoint } from '../utils/edgePath';
import { isTextEditingTarget } from '../utils/noteClipboard';
import { edgesNeedUpdate, markEdgesDirty } from '../services/edgeGeometry';

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

/** 平移/缩放期间隔多久把 transform 提交进 React state（视口裁剪与缩放百分比靠它刷新）。 */
const TRANSFORM_COMMIT_MS = 120;

const toTransformCss = (t: CanvasTransform) =>
  `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;

export function useCanvasInteraction(
  mainRef: RefObject<HTMLDivElement | null>,
  contentContainerRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  edgeLabelsRef: RefObject<HTMLDivElement | null>,
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
  connectingFrom: string | null,
  setConnectingFrom: (v: string | null) => void,
) {
  /**
   * transform 走双轨：`transformRef` + 容器 style 是**即时**的真值（每个 pointermove 都更新，
   * 不经过 React），`canvasTransform` state 是**节流**的副本（裁剪、缩放百分比等衍生 UI 用）。
   * 0.3.x 每次 pointermove 都 setState，一次平移等于几百次 App 全树重渲。
   */
  const [canvasTransform, setCanvasTransformState] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  /** 空格是否按着。ref 供事件回调即时读，state 只为了换手型光标。 */
  const spaceHeldRef = useRef(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  /** 连线拖拽的临时线要跟着鼠标走，mousemove 里靠它判断当下是否在连线。 */
  const connectingRef = useRef(connectingFrom);
  connectingRef.current = connectingFrom;

  const applyTransform = useCallback(
    (next: CanvasTransform, commit: 'now' | 'defer') => {
      transformRef.current = next;
      const el = contentContainerRef.current;
      if (el) el.style.transform = toTransformCss(next);
      markEdgesDirty();
      if (commit === 'now') {
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        setCanvasTransformState(next);
      } else if (!commitTimerRef.current) {
        commitTimerRef.current = setTimeout(() => {
          commitTimerRef.current = null;
          setCanvasTransformState(transformRef.current);
        }, TRANSFORM_COMMIT_MS);
      }
    },
    [contentContainerRef],
  );

  /** 对外的 setter：程序化跳转（复位、适应内容、搜索定位）立即生效并提交。 */
  const setCanvasTransform = useCallback(
    (next: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform)) => {
      const resolved = typeof next === 'function' ? next(transformRef.current) : next;
      applyTransform(resolved, 'now');
    },
    [applyTransform],
  );

  /**
   * 容器的 transform 由这里独占（App 不再把它写进 style prop）：
   * React 任何原因的重渲都不会把节流窗口里的新位置打回旧值。
   * 画布页卸载再挂载得到的是新 DOM 节点，所以每次渲染后都补写一遍。
   */
  useEffect(() => {
    const el = contentContainerRef.current;
    if (el) el.style.transform = toTransformCss(transformRef.current);
  });

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      // 连线途中临时线追着鼠标画，得让 rAF 循环醒着
      if (connectingRef.current) markEdgesDirty();
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  /**
   * 滚轮 = 缩放画布。
   *
   * 例外：指针位于节点内部的可滚动区域（AI 卡正文、文档节点等）且内容尚未滚到边界时，
   * 交给浏览器默认滚动——否则那些卡片里的长文根本没法看。
   *
   * 监听器挂在 `window` 而不是 `<main>` 上，每次事件再回头查 `mainRef.current`。
   * 原因：画布只在「画布」页渲染（`activeTab === 'personal'`），切到研究/长文/角色页
   * 会把 `<main>` 整个卸载，切回来是一个**新的 DOM 节点**。而这个 effect 的依赖是
   * `mainRef` 这个稳定的 ref 对象，永远不会重跑，于是监听器一直留在那个已经被丢弃的
   * 旧节点上——表现就是「切一次页面回来滚轮就不能缩放了」。
   * 挂 window 之后节点换多少次都不影响，用 `contains` 把作用范围限死在画布内。
   */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const main = mainRef.current;
      if (!main) return;

      let node: HTMLElement | null = e.target as HTMLElement;
      if (node && node.nodeType !== Node.ELEMENT_NODE) {
        node = node.parentElement;
      }
      // 画布之外（侧边栏、设置弹窗等）一律交给浏览器
      if (!node || !main.contains(node)) return;
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
      const prev = transformRef.current;
      const zoomBase = 1.05;
      const factor = e.deltaY < 0 ? zoomBase : 1 / zoomBase;
      const newScale = Math.min(Math.max(0.1, prev.scale * factor), 5);

      const mainRect = main.getBoundingClientRect();
      const clientX = e.clientX - mainRect.left;
      const clientY = e.clientY - mainRect.top;

      // 以指针为锚点缩放：指针下的那一点保持不动
      const mouseXInCanvas = (clientX - prev.x) / prev.scale;
      const mouseYInCanvas = (clientY - prev.y) / prev.scale;

      applyTransform(
        {
          x: clientX - mouseXInCanvas * newScale,
          y: clientY - mouseYInCanvas * newScale,
          scale: newScale,
        },
        'defer',
      );
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [mainRef, applyTransform]);

  /**
   * 从某个按下点开始拖动平移。中键与空格+左键共用。
   * 移动期间只写 DOM（节流提交 state 给裁剪用），抬起时整份提交。
   */
  const beginPan = (startX: number, startY: number) => {
    const startTransform = transformRef.current;

    const onPointerMove = (moveEv: PointerEvent) => {
      applyTransform(
        {
          ...startTransform,
          x: startTransform.x + (moveEv.clientX - startX),
          y: startTransform.y + (moveEv.clientY - startY),
        },
        'defer',
      );
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      applyTransform(transformRef.current, 'now');
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

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
    beginPan(e.clientX, e.clientY);
  };

  /**
   * 平移画布 = 按住**空格 + 左键**拖动。
   *
   * 中键平移在笔记本触控板和三键鼠标上都不好按，而空格拖拽是 Figma / Miro / Photoshop
   * 一路下来的通用手势。走**捕获阶段**是为了让它盖过节点自己的拖拽——按住空格时
   * 光标停在卡片上也应该是在拖画布，而不是把那张卡片拽走。
   *
   * 输入框、文本域、contentEditable 里按空格是打字，不能当成手势（见 `isTextEditingTarget`）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTextEditingTarget(e.target)) return;
      spaceHeldRef.current = true;
      setIsSpacePanning(true);
    };
    const releaseSpace = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setIsSpacePanning(false);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      releaseSpace();
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.button !== 0 || !spaceHeldRef.current) return;
      const main = mainRef.current;
      const target = e.target as Node | null;
      if (!main || !target || !main.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      beginPan(e.clientX, e.clientY);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // 切走窗口时按键抬起收不到，回来就会卡在「一直按着空格」的状态
    window.addEventListener('blur', releaseSpace);
    window.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSpace);
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
    };
  }, [mainRef]);

  // 图片/视频加载完成会让卡片长高，连线端点得跟着挪。load 不冒泡，走捕获阶段接住。
  useEffect(() => {
    const onAnyLoad = () => markEdgesDirty();
    window.addEventListener('load', onAnyLoad, { capture: true });
    return () => window.removeEventListener('load', onAnyLoad, true);
  }, []);

  // 开始/放弃连线都要让临时虚线立刻出现或消失
  useEffect(() => {
    markEdgesDirty();
  }, [connectingFrom]);

  // Edge line animation loop
  useEffect(() => {
    let animationFrameId: number;
    const updateLines = () => {
      // 静止的画布不重算：脏标记（见 services/edgeGeometry）没亮就只留一个空 rAF 心跳。
      // 0.3.x 这里每帧对每条边做两次 getBoundingClientRect，画布不动也在强制同步布局。
      if (!edgesNeedUpdate()) {
        animationFrameId = requestAnimationFrame(updateLines);
        return;
      }
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

            // 出口 = 源卡片右侧中点，入口 = 目标卡片左侧中点（不再取卡片中心，
            // 否则线段中段会被不透明卡片盖住，方向也读不出来）。
            const x1 = (fromRect.right - containerRect.left) / currentScale;
            const y1 = (fromRect.top + fromRect.height / 2 - containerRect.top) / currentScale;
            const x2 = (toRect.left - containerRect.left) / currentScale;
            const y2 = (toRect.top + toRect.height / 2 - containerRect.top) / currentScale;

            const d = buildEdgePath(x1, y1, x2, y2);
            g.querySelectorAll('path').forEach((path: SVGPathElement) => {
              path.setAttribute('d', d);
            });

            if (edgeLabelsContainer) {
              const btn = edgeLabelsContainer.querySelector(`[data-edge-btn="${edgeId}"]`) as HTMLButtonElement;
              if (btn) {
                const mid = edgeMidpoint(x1, y1, x2, y2);
                btn.style.left = `${mid.x}px`;
                btn.style.top = `${mid.y}px`;
              }
            }
          }
        });

        const tempEdge = svg.querySelector('#temp-edge') as SVGPathElement | null;
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
            tempEdge.setAttribute('d', buildEdgePath(x1, y1, x2, y2));
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

  return {
    canvasTransform,
    setCanvasTransform,
    transformRef,
    handlePanStart,
    mousePosRef,
    isSpacePanning,
  };
}
