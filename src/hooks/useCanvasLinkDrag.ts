import { useEffect, useRef } from 'react';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../services/keyboardLayers';

/**
 * 连线的「拖一下就连上」与取消手势。
 *
 * 原来只有点击-点击一种模式：点出口起连，再点目标收线。问题有两个——
 * 一是成熟画布（ComfyUI / Figma / n8n）里从端口按住拖到目标松手是最直觉的做法，
 * 这里做不到；二是连线态一旦挂上就没有退路，右键和 Esc 都不管用。
 *
 * 这里把「松手」这件事补上，并保留原来的点击-点击：
 * - 按下端口后**移动超过阈值**再松手 → 按松手位置结算（落节点上就连、落空白就弹新建菜单）
 * - 按下后**没怎么动**就松手 → 什么都不做，维持连线态，等下一次点击（老行为）
 * - 连线途中按 `Esc` 或右键 → 放弃这根线
 *
 * 按下位置用**捕获阶段**监听：端口的 `onPointerDown` 里有 `stopPropagation`，
 * 冒泡阶段拿不到这次按下。
 */

/** 小于这个位移算「点了一下」而不是「拖了一把」，避免手抖把点击误判成拖拽。 */
export const LINK_DRAG_THRESHOLD_PX = 6;

export interface CanvasLinkDragOptions {
  connectingFrom: string | null;
  /** 松手落在某个节点上：连过去。 */
  onDropOnNode: (toId: string) => void;
  /** 松手落在画布空白处：让调用方弹「新建并连上」菜单。 */
  onDropOnCanvas: (fromId: string, clientX: number, clientY: number) => void;
  /** 松手落在画布之外，或用户主动取消：放弃这根线。 */
  onCancel: () => void;
}

export function useCanvasLinkDrag({
  connectingFrom,
  onDropOnNode,
  onDropOnCanvas,
  onCancel,
}: CanvasLinkDragOptions): void {
  // 全部走 ref：监听器只注册一次，回调换了也不用重新挂
  const connectingRef = useRef(connectingFrom);
  const handlersRef = useRef({ onDropOnNode, onDropOnCanvas, onCancel });
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  connectingRef.current = connectingFrom;
  handlersRef.current = { onDropOnNode, onDropOnCanvas, onCancel };

  // 键盘层占用跟着连线态走：拉着线时 'linkdrag' 压住画布层，Esc 先放线；
  // 释放发生在 connectingFrom 清空后的下一次渲染，晚于本次 Esc 的事件分发——
  // 因此同一下 Esc 不会又落到画布去清选区，要再按一次才清。
  useEffect(() => {
    if (!connectingFrom) return;
    return acquireKeyboardLayer('linkdrag');
  }, [connectingFrom]);

  useEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      pressRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const fromId = connectingRef.current;
      const press = pressRef.current;
      pressRef.current = null;
      if (!fromId || !press) return;

      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      // 没怎么动 = 点击-点击模式，线继续挂着等下一次点击
      if (moved < LINK_DRAG_THRESHOLD_PX) return;

      const { onDropOnNode: dropNode, onDropOnCanvas: dropCanvas, onCancel: cancel } =
        handlersRef.current;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el?.closest?.('[data-node-id]') as HTMLElement | null;
      const toId = nodeEl?.dataset.nodeId;
      if (toId) {
        dropNode(toId);
        return;
      }
      if (el?.closest?.('[data-canvas-surface]')) {
        dropCanvas(fromId, e.clientX, e.clientY);
        return;
      }
      // 松在侧边栏之类的地方：这根线没有归宿，丢掉
      cancel();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !connectingRef.current) return;
      // 上面还有更高的层（对话框/搜索/演示）时这下 Esc 不归连线
      if (!isTopKeyboardLayer('linkdrag')) return;
      handlersRef.current.onCancel();
    };

    // 捕获阶段：右键取消要赶在画布/节点的右键菜单之前
    const onContextMenuCapture = (e: MouseEvent) => {
      if (!connectingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      handlersRef.current.onCancel();
    };

    window.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenuCapture, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenuCapture, true);
    };
  }, []);
}
