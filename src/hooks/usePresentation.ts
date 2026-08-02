import { useCallback, useEffect, useRef, useState } from 'react';
import { isTextEditingTarget } from '../utils/noteClipboard';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../services/keyboardLayers';

/**
 * 演示模式播放器（B7）。
 *
 * 只管"现在讲到第几张"：顺序由调用方用 `buildPresentationOrder` 算好传进来，
 * 视口移动通过 `onFocusNode` 回调交还给 App（它有 focusNode 会把卡片居中）——
 * hook 自己不摸画布变换。
 *
 * active 时在 **capture 阶段**挂键盘监听并 stopPropagation：演示翻页要抢在
 * `useCanvasKeyboard` 之前接走方向键（否则一按 → 变成微调选中的卡片）。
 * 焦点在输入框 / contentEditable 里时一律放行（`isTextEditingTarget`），
 * 正在改字时按空格是打空格，不是翻页。
 */

export interface PresentationState {
  active: boolean;
  /** 播放序（nodeId 数组）。 */
  order: string[];
  /** 0 起的当前位置。 */
  index: number;
}

export interface UsePresentationOptions {
  /** 每次翻到一张卡时回调（App 接 focusNode 把卡片居中）。 */
  onFocusNode: (nodeId: string) => void;
}

export interface UsePresentationResult extends PresentationState {
  /** 用给定顺序开始播放（空数组则不进入演示）。 */
  start: (order: string[]) => void;
  /** 下一张；已在最后一张时停住不回绕。 */
  next: () => void;
  /** 上一张；已在第一张时停住。 */
  prev: () => void;
  /** 跳到第 i 张（越界钳制）。 */
  jumpTo: (index: number) => void;
  /** 换一份新顺序继续播：当前卡还在新顺序里就跟着它走，不在则钳制原位置。 */
  reorder: (order: string[]) => void;
  exit: () => void;
}

const IDLE: PresentationState = { active: false, order: [], index: 0 };

export function usePresentation(options: UsePresentationOptions): UsePresentationResult {
  const [state, setState] = useState<PresentationState>(IDLE);
  const { active, order, index } = state;

  // 回调每次渲染可能是新的；ref 转一手，聚焦 effect 与键盘监听都不必跟着重挂。
  const onFocusNodeRef = useRef(options.onFocusNode);
  onFocusNodeRef.current = options.onFocusNode;

  const start = useCallback((nextOrder: string[]) => {
    if (nextOrder.length === 0) return;
    setState({ active: true, order: nextOrder, index: 0 });
  }, []);

  const exit = useCallback(() => setState(IDLE), []);

  const next = useCallback(() => {
    setState((s) =>
      s.active && s.index < s.order.length - 1 ? { ...s, index: s.index + 1 } : s,
    );
  }, []);

  const prev = useCallback(() => {
    setState((s) => (s.active && s.index > 0 ? { ...s, index: s.index - 1 } : s));
  }, []);

  const jumpTo = useCallback((i: number) => {
    setState((s) => {
      if (!s.active || s.order.length === 0) return s;
      const clamped = Math.min(Math.max(i, 0), s.order.length - 1);
      return clamped === s.index ? s : { ...s, index: clamped };
    });
  }, []);

  const reorder = useCallback((nextOrder: string[]) => {
    setState((s) => {
      if (!s.active || nextOrder.length === 0) return s;
      const currentId = s.order[s.index];
      const at = nextOrder.indexOf(currentId);
      return {
        ...s,
        order: nextOrder,
        index: at >= 0 ? at : Math.min(s.index, nextOrder.length - 1),
      };
    });
  }, []);

  // 每次 index / order 变化把当前卡交给 App 居中。重排后当前卡不变也会重聚焦一次——
  // 顺序面板确认后把视口拉回正在讲的卡，正是想要的效果。
  useEffect(() => {
    if (!active) return;
    const nodeId = order[index];
    if (nodeId !== undefined) onFocusNodeRef.current(nodeId);
  }, [active, order, index]);

  // 演示中占 'presentation' 层：画布 Esc（清选区）被压住，全局搜索/对话框仍在其上
  useEffect(() => {
    if (!active) return;
    return acquireKeyboardLayer('presentation');
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;

      let action: (() => void) | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          action = next;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          action = prev;
          break;
        case 'Escape':
          // 上面还压着搜索面板/对话框时这下 Esc 归它们；原样放行（不拦不吞）
          if (!isTopKeyboardLayer('presentation')) return;
          action = exit;
          break;
        case 'End':
          action = exit;
          break;
        case 'Home':
          action = () => jumpTo(0);
          break;
      }
      if (!action) return; // 没接管的按键原样放行（Ctrl+Z 等仍归画布/浏览器）

      // capture 阶段拦下：既不让空格滚动页面，也不让方向键落到 useCanvasKeyboard 变成微调
      e.preventDefault();
      e.stopPropagation();
      action();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, next, prev, exit, jumpTo]);

  return { active, order, index, start, next, prev, jumpTo, reorder, exit };
}
