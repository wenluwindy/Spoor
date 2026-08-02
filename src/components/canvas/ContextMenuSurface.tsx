import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../../services/keyboardLayers';

/**
 * 上下文菜单的呈现层：定位翻转、键盘导航、二级菜单、点击外部收起。
 *
 * 不知道任何画布语义——菜单内容由调用方以 `sections` 传入。
 * 样式与工具栏底部 `+` 悬浮菜单保持一致（白底 / `#E6E4DF` 描边 / `rounded-xl` / `shadow-xl`）。
 */

export interface ContextMenuEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** 图标使用强调色 `#C2410C`。 */
  accent?: boolean;
  /** 破坏性操作，整项转为红色。 */
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** 存在时该项变为二级菜单入口，`onSelect` 被忽略。 */
  submenu?: ContextMenuEntry[];
}

/** 相邻 section 之间画一条分隔线。 */
export interface ContextMenuSection {
  id: string;
  entries: ContextMenuEntry[];
}

export interface ContextMenuSurfaceProps {
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}

const VIEWPORT_PADDING = 8;
const SUBMENU_OVERLAP = 4;

function isSelectable(entry: ContextMenuEntry): boolean {
  return !entry.disabled;
}

function EntryRow({
  entry,
  active,
  onActivate,
  onHover,
  hasSubmenuOpen,
  rowRef,
}: {
  entry: ContextMenuEntry;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
  hasSubmenuOpen: boolean;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = entry.icon;
  const tone = entry.danger
    ? 'text-red-700 hover:bg-red-50'
    : 'text-app-text hover:bg-app-surface-subtle';
  const activeTone = entry.danger ? 'bg-red-50' : 'bg-app-surface-subtle';

  return (
    <button
      type="button"
      role="menuitem"
      ref={rowRef}
      aria-haspopup={entry.submenu ? 'menu' : undefined}
      aria-expanded={entry.submenu ? hasSubmenuOpen : undefined}
      aria-disabled={entry.disabled || undefined}
      disabled={entry.disabled}
      tabIndex={-1}
      onPointerEnter={onHover}
      onPointerDown={(e) => {
        // 用 pointerdown 而非 click：避免右键抬起时误触，也和画布其他控件一致。
        e.preventDefault();
        e.stopPropagation();
        if (!entry.disabled) onActivate();
      }}
      className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${tone} ${
        active && !entry.disabled ? activeTone : ''
      } ${entry.disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      {Icon ? (
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            entry.danger ? 'text-red-600' : entry.accent ? 'text-app-accent' : 'text-app-text-muted'
          }`}
        />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.submenu ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-app-text-faint" /> : null}
    </button>
  );
}

function MenuPanel({
  sections,
  x,
  y,
  /** 二级菜单沿这条竖直边展开，翻转时改从左侧展开。 */
  anchorRight,
  activeId,
  setActiveId,
  onSelect,
  openSubmenuId,
  setOpenSubmenu,
  registerRow,
  panelRef,
  role,
}: {
  sections: ContextMenuSection[];
  x: number;
  y: number;
  anchorRight?: number;
  activeId: string | null;
  setActiveId: (id: string) => void;
  onSelect: (entry: ContextMenuEntry) => void;
  openSubmenuId: string | null;
  setOpenSubmenu: (id: string | null, anchor: DOMRect | null) => void;
  registerRow?: (id: string, el: HTMLButtonElement | null) => void;
  panelRef?: React.Ref<HTMLDivElement>;
  role?: string;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    if (anchorRight !== undefined) {
      // 二级菜单：优先右侧展开，放不下就翻到左侧。
      left = anchorRight - SUBMENU_OVERLAP;
      if (left + width > vw - VIEWPORT_PADDING) left = x - width + SUBMENU_OVERLAP;
    } else if (left + width > vw - VIEWPORT_PADDING) {
      left = x - width;
    }
    left = Math.min(Math.max(left, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, vw - width - VIEWPORT_PADDING));

    let top = y;
    if (top + height > vh - VIEWPORT_PADDING) top = y - height;
    top = Math.min(Math.max(top, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING));

    setPos({ left, top });
  }, [x, y, anchorRight, sections]);

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        if (typeof panelRef === 'function') panelRef(el);
        else if (panelRef && typeof panelRef === 'object') {
          (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      }}
      role={role ?? 'menu'}
      data-canvas-context-menu=""
      tabIndex={-1}
      className="fixed z-[150] flex min-w-[200px] max-w-[280px] flex-col rounded-xl border border-app-border bg-app-surface-raised p-1 shadow-xl outline-none"
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {sections.map((section, sectionIndex) => (
        <React.Fragment key={section.id}>
          {sectionIndex > 0 ? <div className="my-1 h-px bg-app-surface-subtle" /> : null}
          {section.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              active={activeId === entry.id}
              hasSubmenuOpen={openSubmenuId === entry.id}
              rowRef={registerRow ? (el) => registerRow(entry.id, el) : undefined}
              onHover={() => {
                setActiveId(entry.id);
                if (entry.submenu) {
                  const el = localRef.current?.querySelector<HTMLElement>(
                    `[data-entry-id="${entry.id}"]`,
                  );
                  setOpenSubmenu(entry.id, el?.getBoundingClientRect() ?? null);
                } else {
                  setOpenSubmenu(null, null);
                }
              }}
              onActivate={() => onSelect(entry)}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export function ContextMenuSurface({ x, y, sections, onClose }: ContextMenuSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef(new Map<string, HTMLButtonElement | null>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [submenu, setSubmenu] = useState<{ id: string; anchor: DOMRect } | null>(null);

  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const selectable = useMemo(() => flat.filter(isSelectable), [flat]);
  const openSubmenuEntry = submenu ? flat.find((e) => e.id === submenu.id) : undefined;

  const registerRow = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowsRef.current.set(id, el);
    else rowsRef.current.delete(id);
    if (el) el.setAttribute('data-entry-id', id);
  }, []);

  const setOpenSubmenu = useCallback((id: string | null, anchor: DOMRect | null) => {
    setSubmenu(id && anchor ? { id, anchor } : null);
  }, []);

  const handleSelect = useCallback(
    (entry: ContextMenuEntry) => {
      if (entry.submenu) {
        const el = rowsRef.current.get(entry.id);
        setOpenSubmenu(entry.id, el?.getBoundingClientRect() ?? null);
        return;
      }
      entry.onSelect?.();
      onClose();
    },
    [onClose, setOpenSubmenu],
  );

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // 菜单在场即占 'menu' 层：压住画布的 Esc 清选区，同时让位给更高的弹层
  useEffect(() => acquireKeyboardLayer('menu'), []);

  // 点击菜单以外任意位置收起。菜单项本身用 pointerdown 且已 stopPropagation。
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[data-canvas-context-menu]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (selectable.length === 0) return;
      const currentIndex = selectable.findIndex((e) => e.id === activeId);
      const nextIndex =
        currentIndex < 0
          ? delta === 1
            ? 0
            : selectable.length - 1
          : (currentIndex + delta + selectable.length) % selectable.length;
      setActiveId(selectable[nextIndex].id);
    },
    [activeId, selectable],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'ArrowRight': {
        const entry = flat.find((it) => it.id === activeId);
        if (entry?.submenu) {
          e.preventDefault();
          const el = rowsRef.current.get(entry.id);
          setOpenSubmenu(entry.id, el?.getBoundingClientRect() ?? null);
        }
        break;
      }
      case 'ArrowLeft':
        if (submenu) {
          e.preventDefault();
          setOpenSubmenu(null, null);
        }
        break;
      case 'Enter':
      case ' ': {
        const entry = flat.find((it) => it.id === activeId);
        if (entry && isSelectable(entry)) {
          e.preventDefault();
          handleSelect(entry);
        }
        break;
      }
      case 'Escape':
        // 更高的层（对话框等）在场时这下 Esc 不归菜单
        if (!isTopKeyboardLayer('menu')) break;
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div onKeyDown={onKeyDown}>
      <MenuPanel
        panelRef={rootRef}
        sections={sections}
        x={x}
        y={y}
        activeId={activeId}
        setActiveId={setActiveId}
        onSelect={handleSelect}
        openSubmenuId={submenu?.id ?? null}
        setOpenSubmenu={setOpenSubmenu}
        registerRow={registerRow}
      />
      {submenu && openSubmenuEntry?.submenu ? (
        <MenuPanel
          role="menu"
          sections={[{ id: `${submenu.id}-sub`, entries: openSubmenuEntry.submenu }]}
          x={submenu.anchor.left}
          y={submenu.anchor.top}
          anchorRight={submenu.anchor.right}
          activeId={activeId}
          setActiveId={setActiveId}
          onSelect={handleSelect}
          openSubmenuId={null}
          setOpenSubmenu={() => {}}
        />
      ) : null}
    </div>,
    document.body,
  );
}
