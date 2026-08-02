import React from 'react';
import { useSnapGuides } from '../../services/canvasSnapGuides';

/**
 * 拖动吸附命中时的对齐辅助线。渲染在画布内容容器里（跟着 transform 走），
 * 线的坐标是画布单位。订阅走 useSyncExternalStore，没有命中时组件返回 null，
 * 不参与布局。长度取一个"够长"的固定值——真正的无限线不存在，20 万像素
 * 在任何实际缩放下都超出视口。
 */
export function SnapGuideLines() {
  const guides = useSnapGuides();
  if (guides.x === null && guides.y === null) return null;
  return (
    <>
      {guides.x !== null && (
        <div
          data-export-hide=""
          className="pointer-events-none absolute z-40 bg-app-accent/60"
          style={{ left: guides.x, top: -100000, width: 1, height: 200000 }}
        />
      )}
      {guides.y !== null && (
        <div
          data-export-hide=""
          className="pointer-events-none absolute z-40 bg-app-accent/60"
          style={{ top: guides.y, left: -100000, height: 1, width: 200000 }}
        />
      )}
    </>
  );
}
