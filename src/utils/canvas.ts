export interface CanvasViewTransform {
  x: number;
  y: number;
  scale: number;
}

/** Only the fields of `DOMRect` this module needs, so callers can pass a plain object in tests. */
export interface CanvasContainerOrigin {
  left: number;
  top: number;
}

/**
 * Convert a viewport (client) point into canvas coordinates.
 *
 * `containerRect` is the bounding rect of the element the transform is applied inside
 * (the canvas `<main>`), so the result is independent of where the canvas sits on screen.
 * Used by drag-drop and the right-click menu so new nodes land under the pointer
 * instead of at the viewport center.
 */
export function screenToCanvasPosition(
  clientX: number,
  clientY: number,
  containerRect: CanvasContainerOrigin,
  transform: CanvasViewTransform,
) {
  return {
    x: (clientX - containerRect.left - transform.x) / transform.scale,
    y: (clientY - containerRect.top - transform.y) / transform.scale,
  };
}

/**
 * Calculate a position near the center of the viewport in canvas coordinates.
 * Used when creating new nodes so they appear near the visible center.
 */
export function getCanvasCenterPosition(transform: { x: number; y: number; scale: number }) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    x: (cx - transform.x) / transform.scale - 150 + Math.random() * 50,
    y: (cy - transform.y) / transform.scale - 100 + Math.random() * 50,
  };
}
