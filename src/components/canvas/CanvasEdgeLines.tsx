import React, { useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { Edge as DbEdge } from '../../db';
import { preventDefaultIfFileDrag } from '../../utils/dnd';

interface CanvasEdgeLinesProps {
  edges: DbEdge[];
  connectingFrom: string | null;
  svgRef: RefObject<SVGSVGElement | null>;
  edgeLabelsRef: RefObject<HTMLDivElement | null>;
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
  deleteEdge: (id: string) => void;
}

export function CanvasEdgeLines({
  edges,
  connectingFrom,
  svgRef,
  edgeLabelsRef,
  hoveredEdgeId,
  setHoveredEdgeId,
  deleteEdge,
}: CanvasEdgeLinesProps) {
  return (
    <>
      <svg ref={svgRef} data-connecting-from={connectingFrom || ''} className="absolute inset-0 overflow-visible z-10 w-[1px] h-[1px] pointer-events-none">
        {edges.map(edge => (
          <g
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-from={edge.from}
            data-edge-to={edge.to}
            className="group cursor-pointer pointer-events-auto"
            onDragEnter={(e) => preventDefaultIfFileDrag(e)}
            onDragOver={(e) => preventDefaultIfFileDrag(e)}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
          >
            <line
              className="node-connector transition-colors group-hover:stroke-[#C2410C]"
              style={{ strokeWidth: 2, stroke: '#d1cfca', pointerEvents: 'none' }}
            />
            <line
              className="hit-area"
              style={{ strokeWidth: 20, stroke: 'transparent', pointerEvents: 'auto' }}
            />
          </g>
        ))}
        <line id="temp-edge" className="node-connector pointer-events-none" style={{ strokeWidth: 2, stroke: '#C2410C', strokeDasharray: '5,5', display: connectingFrom ? 'block' : 'none' }} />
      </svg>

      <div ref={edgeLabelsRef} className="absolute inset-0 pointer-events-none z-20 w-[1px] h-[1px]">
        {edges.map(edge => (
          <button
            key={`btn-${edge.id}`}
            data-edge-btn={edge.id}
            className={`absolute transform -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-white border border-[#C2410C] text-[#C2410C] hover:bg-[#C2410C] hover:text-white shadow-sm rounded-full flex items-center justify-center transition-all pointer-events-auto z-10 ${hoveredEdgeId === edge.id ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); }}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
            style={{ top: -100, left: -100 }}
          >
            <X className="w-3 h-3" />
          </button>
        ))}
      </div>
    </>
  );
}
