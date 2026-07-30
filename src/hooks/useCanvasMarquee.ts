import { useCallback, useRef, useState, type RefObject } from 'react';

/** 屏幕坐标下的选框，已相对画布容器归一（left/top 为容器内偏移）。 */
export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 位移小于此值按「点击空白」处理：清空选中，而不是画一个零面积的框。 */
const CLICK_THRESHOLD_PX = 4;

interface UseCanvasMarqueeParams {
  mainRef: RefObject<HTMLElement | null>;
  /** 节点 id → DOM 元素，用于命中判定。 */
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * 左键在画布空白处拖出矩形，框内节点进入选中态。
 *
 * 命中判定直接比较屏幕坐标下的包围盒：节点带缩放与轻微旋转，
 * 换算回画布坐标反而更容易出错，而 `getBoundingClientRect()` 已经把两者算进去了。
 *
 * 按住 Shift 为追加选择；不按则替换。空白处单击（位移 < 4px）清空选中。
 */
export function useCanvasMarquee({ mainRef, nodesRef, setSelectedNodes }: UseCanvasMarqueeParams) {
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const activeRef = useRef(false);

  const handleMarqueeStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const main = mainRef.current;
      if (!main) return;

      e.preventDefault();
      activeRef.current = true;

      const containerRect = main.getBoundingClientRect();
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const additive = e.shiftKey;
      let moved = false;

      const toRect = (clientX: number, clientY: number) => ({
        left: Math.min(startClientX, clientX) - containerRect.left,
        top: Math.min(startClientY, clientY) - containerRect.top,
        width: Math.abs(clientX - startClientX),
        height: Math.abs(clientY - startClientY),
      });

      const onPointerMove = (moveEv: PointerEvent) => {
        if (
          !moved &&
          Math.abs(moveEv.clientX - startClientX) < CLICK_THRESHOLD_PX &&
          Math.abs(moveEv.clientY - startClientY) < CLICK_THRESHOLD_PX
        ) {
          return;
        }
        moved = true;
        setMarquee(toRect(moveEv.clientX, moveEv.clientY));
      };

      const onPointerUp = (upEv: PointerEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        activeRef.current = false;
        setMarquee(null);

        if (!moved) {
          // 空白处单击：清空选中
          if (!additive) setSelectedNodes(new Set());
          return;
        }

        const selectionLeft = Math.min(startClientX, upEv.clientX);
        const selectionRight = Math.max(startClientX, upEv.clientX);
        const selectionTop = Math.min(startClientY, upEv.clientY);
        const selectionBottom = Math.max(startClientY, upEv.clientY);

        const hit = new Set<string>();
        for (const [id, el] of Object.entries(nodesRef.current ?? {})) {
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const intersects =
            r.right >= selectionLeft &&
            r.left <= selectionRight &&
            r.bottom >= selectionTop &&
            r.top <= selectionBottom;
          if (intersects) hit.add(id);
        }

        setSelectedNodes((prev) => (additive ? new Set([...prev, ...hit]) : hit));
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [mainRef, nodesRef, setSelectedNodes],
  );

  return { marquee, handleMarqueeStart };
}
