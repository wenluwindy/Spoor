import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { colorPresets, fontPresets } from '../../constants/presets';
import { isDarkNodeBackground } from '../../utils/nodePaletteTone';
import { useDraggable } from '../../hooks/useDraggable';
import { useCanvasGrid } from '../../hooks/useCanvasGrid';
import { CANVAS_GRID_SIZE } from '../../services/canvasGrid';
import { useResizable } from '../../hooks/useResizable';
import { Tooltip } from '../ui/Tooltip';

export interface DraggableNodeProps {
  id: string;
  nodesRef: React.MutableRefObject<Record<string, HTMLElement | null>>;
  isConnecting: boolean;
  onLink: (id: string) => void;
  children: React.ReactNode;
  initialX?: number;
  initialY?: number;
  onDelete?: () => void;
  className?: string;
  scale?: number;
  isSelected?: boolean;
  /** 当前选区的全部节点 id：本节点在其中且选区 >1 时，拖它等于拖整组。 */
  selectedIds?: string[];
  isEditing?: boolean;
  onToggleSelect?: () => void;
  allowPalette?: boolean;
  onDragEnd?: (id: string, pos: {x: number, y: number}) => void;
  onResizeEnd?: (size: { width: number, height: number }) => void;
  initialWidth?: number;
  initialHeight?: number;
  rotation?: number;
  /** When set (glass note layout), palette does not paint an opaque layer on this root so `backdrop-filter` on the card can sample the canvas. */
  glassSurface?: boolean;
  /** Note/text: card body pointer sets which node Ctrl+C duplicates (not from checkbox). */
  onStickyActivate?: (id: string) => void;
  /** Right-click on the card opens the canvas context menu for this node. */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>, id: string) => void;
}

export const DraggableNode: React.FC<DraggableNodeProps> = ({ 
  id, nodesRef, isConnecting, onLink, children, 
  initialX = 100, initialY = 100, initialWidth = 320, initialHeight = 0,
  onDelete, className = '', scale = 1, 
  isSelected, selectedIds, isEditing, onToggleSelect, allowPalette, onDragEnd, onResizeEnd,
  rotation = 0,
  glassSurface = false,
  onStickyActivate,
  onContextMenu,
}) => {
  const { t } = useTranslation();
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  /** 编辑正文时隐藏外链、布局/删除、缩放手柄等外围控件（避免 group-hover 仍显示） */
  const hideChrome = Boolean(isEditing);

  const gridEnabled = useCanvasGrid();
  const node = useDraggable(
    initialX,
    initialY,
    scale,
    (pos) => {
      if (onDragEnd) onDragEnd(id, pos);
    },
    { id, snap: gridEnabled ? CANVAS_GRID_SIZE : 0, groupIds: selectedIds },
  );

  const { size, onPointerDown: onResizePointerDown } = useResizable(initialWidth, initialHeight, scaleRef, (newSize) => {
    if (onResizeEnd) onResizeEnd(newSize);
  });

  const [showPalette, setShowPalette] = useState(false);
  const [styleOverrides, setStyleOverrides] = useState({ bg: '', text: '', font: '', border: '' });

  const paletteColorChoices = glassSurface ? colorPresets.slice(3) : colorPresets;
  return (
    <div 
      className={`absolute cursor-move group pointer-events-auto select-none ${className} ${isSelected && !hideChrome ? 'ring-2 ring-app-accent' : ''}`}
      // 连线拖到一半松手时靠它做命中判定（见 hooks/useCanvasLinkDrag）
      data-node-id={id}
      data-glass-surface={glassSurface ? '' : undefined}
      data-node-tone={
        styleOverrides.bg
          ? isDarkNodeBackground(styleOverrides.bg)
            ? 'dark'
            : 'light'
          : undefined
      }
      style={{ 
        left: node.pos.x, 
        top: node.pos.y, 
        width: size.width || undefined,
        height: size.height || undefined,
        zIndex: node.zIndex,
        ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
        '--node-bg': styleOverrides.bg || undefined, 
        '--node-text': styleOverrides.text || undefined, 
        '--node-font': styleOverrides.font || undefined, 
        '--node-border': styleOverrides.border || undefined 
      } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (allowPalette) {
          e.stopPropagation();
          setShowPalette(true);
        }
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              if (showPalette) setShowPalette(false);
              onContextMenu(e, id);
            }
          : undefined
      }
      onPointerDown={(e) => {
        // 右键/中键交给画布右键菜单与平移逻辑；否则右键按住会把节点拖走。
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (
          onStickyActivate &&
          !target.closest('button') &&
          !target.closest('.node-palette') &&
          !target.closest('.cursor-nwse-resize')
        ) {
          onStickyActivate(id);
        }
        if (showPalette) setShowPalette(false);
        if (isConnecting) {
          e.stopPropagation();
          e.preventDefault();
          onLink(id);
        } else {
          node.onPointerDown(e);
        }
      }}
      ref={el => { if (nodesRef) nodesRef.current[id] = el; }}
    >
      {onToggleSelect && (
        <Tooltip label={t('canvas.select_note')}>
          <button
            data-export-hide=""
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onToggleSelect(); }}
            className={`absolute -top-3 -left-3 w-6 h-6 bg-app-surface-raised border ${isSelected ? 'border-app-accent text-app-accent opacity-100' : 'border-app-border text-transparent hover:border-app-accent opacity-0 group-hover:opacity-40'} rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${hideChrome ? '!opacity-0 pointer-events-none' : ''}`}
          >
            <Check className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      {/*
        入口（左中）与出口（右中）是连线的两个固定锚点，连线几何按它们计算
        （见 utils/edgePath）。出口起连，入口收线——方向因此在画布上可读。
      */}
      <Tooltip label={t('canvas.port_in')}>
        <button
          data-port="in"
          data-export-hide=""
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onLink(id); }}
          className={`absolute top-1/2 -mt-2.5 -left-2.5 w-5 h-5 rounded-full border-2 transition-all z-10 shadow-sm ${
            isConnecting
              ? 'bg-app-accent/15 border-app-accent scale-110'
              : 'bg-app-surface-raised border-app-edge hover:border-app-accent'
          } ${
            hideChrome
              ? '!opacity-0 pointer-events-none'
              : isConnecting || isSelected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-70'
          }`}
        />
      </Tooltip>
      <Tooltip label={t('canvas.port_out')}>
        <button
          data-port="out"
          data-export-hide=""
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onLink(id); }}
          className={`absolute top-1/2 -mt-3 -right-3 w-6 h-6 bg-app-surface-raised border border-app-border rounded-full flex items-center justify-center text-app-text-faint hover:text-app-accent hover:border-app-accent transition-all z-10 shadow-sm ${
            hideChrome
              ? '!opacity-0 pointer-events-none'
              : isSelected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </Tooltip>
      <div
        data-export-hide=""
        className={`absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 transition-opacity z-10 ${
          hideChrome
            ? '!opacity-0 pointer-events-none'
            : isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {onDelete && (
          <Tooltip label={t('canvas.delete_note')}>
            <button
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }}
              className="w-6 h-6 bg-app-surface-raised border border-app-border rounded-full flex items-center justify-center text-app-text-faint hover:text-app-accent hover:border-app-accent transition-all shadow-sm"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </Tooltip>
        )}
      </div>
      {children}
      
      {/* Resize Handle */}
      <div 
        data-export-hide=""
        onPointerDown={onResizePointerDown}
        className={`absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize flex items-center justify-center transition-opacity z-20 ${
          hideChrome
            ? '!opacity-0 pointer-events-none'
            : isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div className="w-1.5 h-1.5 border-r border-b border-app-text-faint"></div>
      </div>

      {showPalette && allowPalette && (
        <div 
          data-export-hide=""
          className="node-palette absolute -bottom-14 left-0 bg-app-surface-raised/90 backdrop-blur-md border border-app-border shadow-xl rounded-lg p-2 z-50 flex items-center gap-4 cursor-default pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()} /* Prevent drag when clicking palette */
        >
          <div className="flex gap-1.5">
            {paletteColorChoices.map((color, i) => (
              <Tooltip key={glassSurface ? i + 3 : i} label={t('canvas.change_color')}>
                <button
                  onClick={() => setStyleOverrides(prev => ({ ...prev, bg: color.bg, text: color.text, border: color.border }))}
                  className="w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-110 shadow-sm"
                  style={{ backgroundColor: color.bg }}
                />
              </Tooltip>
            ))}
          </div>
          <div className="w-[1px] h-4 bg-app-border"></div>
          <div className="flex gap-2 text-xs">
            {fontPresets.map((font, i) => (
              <button
                key={i}
                onClick={() => setStyleOverrides(prev => ({ ...prev, font: font.value }))}
                className="px-2 py-0.5 rounded hover:bg-app-surface-subtle text-app-text-muted hover:text-app-text transition-colors"
                title={`${t('canvas.change_font')}: ${font.name}`}
                style={{ fontFamily: font.value }}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
