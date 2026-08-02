import { useState, useRef, useEffect } from 'react';
import { markEdgesDirty } from '../services/edgeGeometry';

export function useResizable(initialWidth: number, initialHeight: number, scaleRef: { readonly current: number }, onResizeEnd?: (size: { width: number, height: number }) => void) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const sizeRef = useRef(size);
  /** 拉伸进行中：这会儿本地值才是最新的，不接管外部尺寸。 */
  const resizingRef = useRef(false);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  /** 外部改了尺寸就跟上（撤销一次拉伸改的是库，和 useDraggable 的坐标同步同理）。 */
  useEffect(() => {
    if (resizingRef.current) return;
    setSize((prev) =>
      prev.width === initialWidth && prev.height === initialHeight
        ? prev
        : { width: initialWidth, height: initialHeight },
    );
  }, [initialWidth, initialHeight]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialSize = { ...size };

    const onPointerMove = (moveEvent: PointerEvent) => {
      setSize({
        width: Math.max(100, initialSize.width + (moveEvent.clientX - startX) / scaleRef.current),
        height: Math.max(50, initialSize.height + (moveEvent.clientY - startY) / scaleRef.current),
      });
      // 卡片边缘在动，连线端点要跟上
      markEdgesDirty();
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      resizingRef.current = false;
      if (onResizeEnd) {
        onResizeEnd(sizeRef.current);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { size, onPointerDown };
}
