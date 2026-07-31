import React, { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Edge as DbEdge } from '../../db';
import { Tooltip } from '../ui/Tooltip';

interface CanvasEdgeLinesProps {
  edges: DbEdge[];
  connectingFrom: string | null;
  svgRef: RefObject<SVGSVGElement | null>;
  edgeLabelsRef: RefObject<HTMLDivElement | null>;
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
  deleteEdge: (id: string) => void;
  /** Right-click on a connection (its wide hit area) opens the context menu for that edge. */
  onEdgeContextMenu?: (e: React.MouseEvent, edgeId: string) => void;
}

/**
 * 箭头 `fill="context-stroke"` 取所在 path 的描边色，于是主题换色与 hover 高亮
 * 都自动跟上，不必为每种状态各定义一个 marker。
 */
const ARROW_MARKER_ID = 'spoor-edge-arrow';

export function CanvasEdgeLines({
  edges,
  connectingFrom,
  svgRef,
  edgeLabelsRef,
  hoveredEdgeId,
  setHoveredEdgeId,
  deleteEdge,
  onEdgeContextMenu,
}: CanvasEdgeLinesProps) {
  const { t } = useTranslation();
  return (
    <>
      <svg ref={svgRef} data-connecting-from={connectingFrom || ''} className="absolute inset-0 overflow-visible z-10 w-[1px] h-[1px] pointer-events-none">
        <defs>
          <marker
            id={ARROW_MARKER_ID}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
          </marker>
        </defs>
        {edges.map(edge => (
          <g
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-from={edge.from}
            data-edge-to={edge.to}
            className="group cursor-pointer pointer-events-auto"
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
            onContextMenu={onEdgeContextMenu ? (e) => onEdgeContextMenu(e, edge.id) : undefined}
          >
            <path
              className="node-connector transition-colors group-hover:stroke-app-accent"
              markerEnd={`url(#${ARROW_MARKER_ID})`}
              style={{ strokeWidth: 2, stroke: 'var(--color-app-edge)', fill: 'none', pointerEvents: 'none' }}
            />
            <path
              className="hit-area"
              style={{ strokeWidth: 20, stroke: 'transparent', fill: 'none', pointerEvents: 'auto' }}
            />
          </g>
        ))}
        <path
          id="temp-edge"
          className="node-connector pointer-events-none"
          markerEnd={`url(#${ARROW_MARKER_ID})`}
          style={{ strokeWidth: 2, stroke: 'var(--color-app-accent)', fill: 'none', strokeDasharray: '5,5', display: connectingFrom ? 'block' : 'none' }}
        />
      </svg>

      <div ref={edgeLabelsRef} className="absolute inset-0 pointer-events-none z-20 w-[1px] h-[1px]">
        {edges.map(edge => (
          <Tooltip key={`btn-${edge.id}`} label={t('canvas.menu.delete_edge')}>
          <button
            data-edge-btn={edge.id}
            className={`absolute transform -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-app-surface-raised border border-app-accent text-app-accent hover:bg-app-accent hover:text-app-on-inverse shadow-sm rounded-full flex items-center justify-center transition-all pointer-events-auto z-10 ${hoveredEdgeId === edge.id ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); }}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
            style={{ top: -100, left: -100 }}
          >
            <X className="w-3 h-3" />
          </button>
          </Tooltip>
        ))}
      </div>
    </>
  );
}
