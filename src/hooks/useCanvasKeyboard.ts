import { useEffect, useRef } from 'react';
import { isTextEditingTarget } from '../utils/noteClipboard';

export interface CanvasKeyboardHandlers {
  onUndo: () => void;
  onRedo: () => void;
  /** Delete / Backspace：删掉当前选区。 */
  onDeleteSelection: () => void;
  /** Ctrl+A：全选当前画布的节点。 */
  onSelectAll: () => void;
  /** Ctrl+D：就地复制选区。 */
  onDuplicateSelection: () => void;
  /** Esc：清空选区（正在拉线时由 `useCanvasLinkDrag` 先接走）。 */
  onClearSelection: () => void;
  /** 方向键微调选区，单位是画布坐标。 */
  onNudgeSelection: (dx: number, dy: number) => void;
  /** Ctrl+0：视图复位。 */
  onResetView: () => void;
  /** Ctrl+1：缩放至适应全部内容。 */
  onZoomToFit: () => void;
  /** Ctrl+F：打开画布内搜索。 */
  onOpenSearch: () => void;
}

export interface UseCanvasKeyboardParams extends CanvasKeyboardHandlers {
  /** 只在画布页且没有弹窗遮挡时生效。 */
  enabled: boolean;
  /**
   * 方向键一次走多远。网格开着时传格宽，一按就是一格；关着时传 1，用于精调。
   * 按住 Shift 在此基础上 ×10。
   */
  nudgeStep: number;
}

/** Shift + 方向键的倍率。 */
export const NUDGE_COARSE_MULTIPLIER = 10;

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * 画布的全局快捷键。
 *
 * 集中在一个 hook 里，而不是各处零散 `addEventListener`：快捷键之间要互相知道
 * 谁先谁后（比如输入框里的 Ctrl+Z 必须让给浏览器原生撤销），散在四处就没法保证。
 *
 * 两条判断贯穿全部按键：
 * - 焦点在输入框 / contentEditable 里时一律放行给原生行为（`isTextEditingTarget`）。
 *   这一条对 Delete 尤其要紧——正在改便签正文时按退格是删字，不是删卡片。
 * - `enabled` 为假（不在画布页、或设置面板开着）时整个 hook 不挂监听。
 */
export function useCanvasKeyboard(params: UseCanvasKeyboardParams): void {
  const { enabled, nudgeStep } = params;

  // 处理函数每次渲染都是新的；用 ref 转一手，监听器就不必跟着重挂。
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const h = paramsRef.current;
      const mod = e.ctrlKey || e.metaKey;

      if (!mod) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          h.onDeleteSelection();
          return;
        }
        if (e.key === 'Escape') {
          h.onClearSelection();
          return;
        }
        const delta = ARROW_DELTAS[e.key];
        if (delta) {
          e.preventDefault();
          const step = h.nudgeStep * (e.shiftKey ? NUDGE_COARSE_MULTIPLIER : 1);
          h.onNudgeSelection(delta[0] * step, delta[1] * step);
        }
        return;
      }

      const key = e.key.toLowerCase();
      // Ctrl+Shift+Z 与 Ctrl+Y 都是重做：前者是 Figma / Miro 的写法，后者是 Windows 的老习惯
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        h.onUndo();
        return;
      }
      if (key === 'a') {
        e.preventDefault();
        h.onSelectAll();
        return;
      }
      if (key === 'd') {
        e.preventDefault();
        h.onDuplicateSelection();
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        h.onOpenSearch();
        return;
      }
      if (key === '0') {
        e.preventDefault();
        h.onResetView();
        return;
      }
      if (key === '1') {
        e.preventDefault();
        h.onZoomToFit();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, nudgeStep]);
}
