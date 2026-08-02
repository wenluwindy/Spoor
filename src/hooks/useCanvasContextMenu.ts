import { useCallback, useEffect, useState, type RefObject } from 'react';
import { screenToCanvasPosition, type CanvasViewTransform } from '../utils/canvas';
import { isTextEditingTarget } from '../utils/noteClipboard';
import { isTopKeyboardLayer } from '../services/keyboardLayers';

/**
 * 右键落在什么上。`nodes` 为多选态（S5 起使用），`anchorId` 是实际被右键的那个节点。
 *
 * `link-drop` 不是右键触发的：从卡片出口拖出的连线松手在空白处时复用同一套菜单，
 * 让用户当场建一张卡并自动连上，而不是让线凭空消失。
 */
export type CanvasContextTarget =
  | { kind: 'canvas' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'nodes'; nodeIds: string[]; anchorId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'link-drop'; fromId: string };

export interface CanvasContextMenuState {
  /** 视口坐标，用于摆放菜单本身（菜单是 fixed，不受画布 transform 影响）。 */
  screenX: number;
  screenY: number;
  /** 画布坐标，用于决定新建节点落在哪。 */
  canvasX: number;
  canvasY: number;
  target: CanvasContextTarget;
}

/** `React.MouseEvent` 与原生 `MouseEvent` 的公共子集，便于测试直接构造。 */
interface ContextMenuTrigger {
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const IDENTITY_TRANSFORM: CanvasViewTransform = { x: 0, y: 0, scale: 1 };

/**
 * 画布右键菜单的状态机。
 *
 * 只负责「开/关 + 坐标换算 + 何时自动收起」，具体菜单项由 `CanvasContextMenu` 组装。
 */
export function useCanvasContextMenu(
  mainRef: RefObject<HTMLElement | null>,
  transformRef: RefObject<CanvasViewTransform>,
) {
  const [menu, setMenu] = useState<CanvasContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const openContextMenu = useCallback(
    (e: ContextMenuTrigger, target: CanvasContextTarget) => {
      // 输入框 / textarea / contentEditable 内保留浏览器原生菜单，否则没法复制粘贴文字。
      if (isTextEditingTarget(e.target)) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = mainRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const transform = transformRef.current ?? IDENTITY_TRANSFORM;
      const { x, y } = screenToCanvasPosition(e.clientX, e.clientY, rect, transform);

      setMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: x, canvasY: y, target });
    },
    [mainRef, transformRef],
  );

  // 画布一动（缩放/平移/窗口变化），菜单位置就不再对应原来的落点，直接收起。
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 'menu' 层由菜单面板（ContextMenuSurface）挂载时占用；更高的层在场时不动作
      if (e.key === 'Escape' && isTopKeyboardLayer('menu')) closeContextMenu();
    };
    window.addEventListener('wheel', closeContextMenu, { capture: true, passive: true });
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', closeContextMenu, true);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, closeContextMenu]);

  return { menu, openContextMenu, closeContextMenu };
}
