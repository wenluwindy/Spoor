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
