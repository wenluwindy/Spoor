import { useState, useRef, useEffect } from 'react';

export function useResizable(initialWidth: number, initialHeight: number, scaleRef: React.MutableRefObject<number>, onResizeEnd?: (size: { width: number, height: number }) => void) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const sizeRef = useRef(size);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const initialSize = { ...size };

    const onPointerMove = (moveEvent: PointerEvent) => {
      setSize({
        width: Math.max(100, initialSize.width + (moveEvent.clientX - startX) / scaleRef.current),
        height: Math.max(50, initialSize.height + (moveEvent.clientY - startY) / scaleRef.current),
      });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (onResizeEnd) {
        onResizeEnd(sizeRef.current);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { size, onPointerDown };
}
