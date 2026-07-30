import React, { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 纸质风悬停提示，替代原生 `title`。
 *
 * 之所以不用原生 `title`：延迟约 1s 不可调、样式不可控、与画布的纸质外观割裂。
 * 全应用统一走本组件，避免两种提示样式混搭。
 *
 * 用法上直接包住**单个**可交互元素，不额外插入 DOM 节点（很多按钮依赖
 * `absolute -top-3 -left-3` 这类定位，外层再套 `<span>` 会破坏布局）：
 *
 * ```tsx
 * <Tooltip label={t('canvas.delete_note')}>
 *   <button onPointerDown={…}><Trash2 /></button>
 * </Tooltip>
 * ```
 */

/** 悬停多久才弹出。既不至于扫过就闪，也不至于等得难受。 */
export const TOOLTIP_DELAY_MS = 400;

/** 提示框与触发元素之间的间距（含箭头）。 */
const TOOLTIP_GAP = 8;
/** 贴边时与视口保持的最小距离。 */
const VIEWPORT_PADDING = 8;

export interface TooltipProps {
  /** 提示文案；为空时等同于不启用。 */
  label: string;
  /** 单个可交互子元素。 */
  children: React.ReactElement;
  /** 优先摆放方向，空间不足时自动翻转到另一侧。 */
  placement?: 'top' | 'bottom';
  /** 显式关掉（例如按钮上已有完整可见文案时）。 */
  disabled?: boolean;
  /** 覆盖默认延迟，仅用于测试或特殊场景。 */
  delayMs?: number;
  /**
   * 不把 `label` 写成子元素的 `aria-label`。
   * 当子元素已有可见文字、`aria-label` 会覆盖它时使用。
   */
  skipAriaLabel?: boolean;
}

interface Placed {
  top: number;
  left: number;
  arrowLeft: number;
  placement: 'top' | 'bottom';
}

type AnyProps = Record<string, unknown>;

function callBoth<E>(theirs: ((e: E) => void) | undefined, ours: (e: E) => void) {
  return (e: E) => {
    theirs?.(e);
    ours(e);
  };
}

export function Tooltip({
  label,
  children,
  placement = 'top',
  disabled,
  delayMs = TOOLTIP_DELAY_MS,
  skipAriaLabel,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabled = !disabled && label.trim().length > 0;

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancelTimer();
    setOpen(false);
    setPlaced(null);
  }, [cancelTimer]);

  const scheduleShow = useCallback(() => {
    if (!enabled) return;
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, delayMs);
  }, [cancelTimer, delayMs, enabled]);

  useEffect(() => cancelTimer, [cancelTimer]);

  // 一旦触发元素不再启用提示（例如变成 disabled），立即收起，避免留下孤儿提示。
  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);

  // 定位：先渲染出来量尺寸，再算最终坐标；`placed` 为空时提示是不可见的。
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;

    const anchor = trigger.getBoundingClientRect();
    const { width: tipW, height: tipH } = tip.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const fitsAbove = anchor.top - tipH - TOOLTIP_GAP >= VIEWPORT_PADDING;
    const fitsBelow = anchor.bottom + tipH + TOOLTIP_GAP <= viewportH - VIEWPORT_PADDING;
    const resolved: 'top' | 'bottom' =
      placement === 'top' ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top';

    const top =
      resolved === 'top' ? anchor.top - tipH - TOOLTIP_GAP : anchor.bottom + TOOLTIP_GAP;

    const anchorCenterX = anchor.left + anchor.width / 2;
    const maxLeft = Math.max(VIEWPORT_PADDING, viewportW - tipW - VIEWPORT_PADDING);
    const left = Math.min(Math.max(anchorCenterX - tipW / 2, VIEWPORT_PADDING), maxLeft);

    setPlaced({ top, left, arrowLeft: anchorCenterX - left, placement: resolved });
  }, [open, placement, label]);

  // 画布平移/缩放、窗口变化、失焦都会让固定定位的提示落在错误位置，直接收起。
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open, hide]);

  if (!isValidElement(children)) return children;

  const childProps = children.props as AnyProps;
  const childRef = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref;

  const merged: AnyProps = {
    ...childProps,
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      if (typeof childRef === 'function') childRef(node);
      else if (childRef && typeof childRef === 'object') {
        (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onPointerEnter: callBoth(childProps.onPointerEnter as ((e: unknown) => void) | undefined, scheduleShow),
    onPointerLeave: callBoth(childProps.onPointerLeave as ((e: unknown) => void) | undefined, hide),
    onPointerDown: callBoth(childProps.onPointerDown as ((e: unknown) => void) | undefined, hide),
    onFocus: callBoth(childProps.onFocus as ((e: unknown) => void) | undefined, scheduleShow),
    onBlur: callBoth(childProps.onBlur as ((e: unknown) => void) | undefined, hide),
  };

  if (enabled && !skipAriaLabel && childProps['aria-label'] == null) {
    merged['aria-label'] = label;
  }

  return (
    <>
      {cloneElement(children, merged)}
      {open && enabled && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              data-tooltip=""
              data-placement={placed?.placement ?? placement}
              className="pointer-events-none fixed z-[200] rounded-md border border-[#E6E4DF] bg-white px-2 py-1 font-sans text-[11px] leading-snug text-[#1a1a1a] shadow-lg"
              style={{
                top: placed?.top ?? 0,
                left: placed?.left ?? 0,
                visibility: placed ? 'visible' : 'hidden',
                maxWidth: 260,
              }}
            >
              {label}
              <span
                aria-hidden
                className="absolute h-2 w-2 rotate-45 border-[#E6E4DF] bg-white"
                style={{
                  left: (placed?.arrowLeft ?? 0) - 4,
                  ...(placed?.placement === 'bottom'
                    ? { top: -5, borderLeftWidth: 1, borderTopWidth: 1 }
                    : { bottom: -5, borderRightWidth: 1, borderBottomWidth: 1 }),
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
