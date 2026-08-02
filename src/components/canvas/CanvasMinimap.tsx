import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, X } from 'lucide-react';
import type { CanvasNode } from '../../db';
import type { CanvasTransform } from '../../hooks/useCanvasInteraction';
import { Tooltip } from '../ui/Tooltip';

/** 小地图画幅（像素）。 */
const MAP_W = 192;
const MAP_H = 128;
/** 世界包围盒外扩比例，免得卡片贴着小地图边缘。 */
const WORLD_PADDING_RATIO = 0.08;

const COLLAPSED_KEY = 'canvas_minimap_collapsed';

const ASSUMED_WIDTH = 320;
const ASSUMED_HEIGHT = 160;

export interface CanvasMinimapProps {
  nodes: CanvasNode[];
  canvasTransform: CanvasTransform;
  mainRef: React.RefObject<HTMLDivElement | null>;
  setCanvasTransform: (next: CanvasTransform) => void;
}

/**
 * 小地图：右下角一块缩略图，画出全部卡片与当前视口框，点击/拖动直接平移视口。
 *
 * 有了视口裁剪（0.3.1）之后大画布才是常态——看不见的卡片不渲染了，
 * "我在画布的哪儿、别的东西都在哪儿"就没有别的答案来源了，小地图补的就是这个。
 *
 * 只依赖 `canvasTransform`（节流提交的副本）与节点几何：平移中最多滞后一个提交
 * 窗口（120ms），换来的是拖画布时小地图不参与每帧渲染。
 */
export function CanvasMinimap({ nodes, canvasTransform, mainRef, setCanvasTransform }: CanvasMinimapProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const surfaceRef = useRef<HTMLDivElement>(null);

  const toggle = (next: boolean) => {
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
  };

  const viewportRect = useMemo(() => {
    const rect = mainRef.current?.getBoundingClientRect();
    const scale = canvasTransform.scale || 1;
    return {
      x: -canvasTransform.x / scale,
      y: -canvasTransform.y / scale,
      width: (rect?.width ?? 0) / scale,
      height: (rect?.height ?? 0) / scale,
    };
  }, [canvasTransform, mainRef]);

  /** 世界包围盒 = 全部卡片 ∪ 当前视口。视口也算进去：空画布上小地图也得能表达"我在哪"。 */
  const world = useMemo(() => {
    let left = viewportRect.x;
    let top = viewportRect.y;
    let right = viewportRect.x + viewportRect.width;
    let bottom = viewportRect.y + viewportRect.height;
    for (const n of nodes) {
      left = Math.min(left, n.x);
      top = Math.min(top, n.y);
      right = Math.max(right, n.x + (n.width ?? ASSUMED_WIDTH));
      bottom = Math.max(bottom, n.y + (n.height || ASSUMED_HEIGHT));
    }
    const padX = (right - left) * WORLD_PADDING_RATIO;
    const padY = (bottom - top) * WORLD_PADDING_RATIO;
    left -= padX;
    top -= padY;
    right += padX;
    bottom += padY;
    const scale = Math.min(MAP_W / Math.max(1, right - left), MAP_H / Math.max(1, bottom - top));
    // 居中：短边留白对称
    const offsetX = (MAP_W - (right - left) * scale) / 2;
    const offsetY = (MAP_H - (bottom - top) * scale) / 2;
    return { left, top, scale, offsetX, offsetY };
  }, [nodes, viewportRect]);

  const toMap = useCallback(
    (x: number, y: number) => ({
      x: (x - world.left) * world.scale + world.offsetX,
      y: (y - world.top) * world.scale + world.offsetY,
    }),
    [world],
  );

  /** 点哪儿视口中心就挪到哪儿；按住拖动连续生效。 */
  const navigateTo = useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceRef.current;
      const main = mainRef.current;
      if (!surface || !main) return;
      const box = surface.getBoundingClientRect();
      const worldX = (clientX - box.left - world.offsetX) / world.scale + world.left;
      const worldY = (clientY - box.top - world.offsetY) / world.scale + world.top;
      const view = main.getBoundingClientRect();
      const scale = canvasTransform.scale || 1;
      setCanvasTransform({
        x: view.width / 2 - worldX * scale,
        y: view.height / 2 - worldY * scale,
        scale,
      });
    },
    [world, mainRef, canvasTransform.scale, setCanvasTransform],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    navigateTo(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => navigateTo(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (collapsed) {
    return (
      <div className="absolute bottom-24 right-4 z-40" data-export-hide="">
        <Tooltip label={t('canvas.minimap_show')}>
          <button
            type="button"
            onClick={() => toggle(false)}
            aria-label={t('canvas.minimap_show')}
            className="bg-app-surface-raised text-app-text-muted p-2.5 rounded-full shadow-md border border-app-border hover:text-app-accent hover:border-app-accent transition-colors flex items-center justify-center"
          >
            <MapIcon className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    );
  }

  const vpTopLeft = toMap(viewportRect.x, viewportRect.y);
  const vpBottomRight = toMap(viewportRect.x + viewportRect.width, viewportRect.y + viewportRect.height);

  return (
    <div
      className="absolute bottom-24 right-4 z-40 rounded-lg border border-app-border bg-app-surface-raised/95 shadow-lg backdrop-blur-sm overflow-hidden"
      data-export-hide=""
    >
      <div className="flex items-center justify-between border-b border-app-border/60 px-2 py-1">
        <span className="text-[10px] font-sans text-app-text-faint">{t('canvas.minimap_title')}</span>
        <Tooltip label={t('canvas.minimap_hide')}>
          <button
            type="button"
            onClick={() => toggle(true)}
            aria-label={t('canvas.minimap_hide')}
            className="rounded p-0.5 text-app-text-faint hover:text-app-accent transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </Tooltip>
      </div>
      <div
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        className="relative cursor-crosshair"
        style={{ width: MAP_W, height: MAP_H }}
      >
        <svg width={MAP_W} height={MAP_H} className="absolute inset-0">
          {nodes.map((n) => {
            const p = toMap(n.x, n.y);
            const w = Math.max(2, (n.width ?? ASSUMED_WIDTH) * world.scale);
            const h = Math.max(2, (n.height || ASSUMED_HEIGHT) * world.scale);
            return (
              <rect
                key={n.id}
                x={p.x}
                y={p.y}
                width={w}
                height={h}
                rx={1}
                fill={n.type === 'frame' ? 'transparent' : 'var(--color-app-text-faint)'}
                stroke={n.type === 'frame' ? 'var(--color-app-text-faint)' : 'none'}
                strokeWidth={n.type === 'frame' ? 0.75 : 0}
                opacity={0.55}
              />
            );
          })}
          <rect
            x={vpTopLeft.x}
            y={vpTopLeft.y}
            width={Math.max(4, vpBottomRight.x - vpTopLeft.x)}
            height={Math.max(4, vpBottomRight.y - vpTopLeft.y)}
            fill="var(--color-app-accent)"
            fillOpacity={0.08}
            stroke="var(--color-app-accent)"
            strokeWidth={1}
            rx={2}
          />
        </svg>
      </div>
    </div>
  );
}
