import { useSyncExternalStore } from 'react';
import { isCanvasGridEnabled, subscribeCanvasGrid } from '../services/canvasGrid';

/** 订阅画布网格开关（同时决定网格是否显示、拖拽是否吸附）。 */
export function useCanvasGrid(): boolean {
  return useSyncExternalStore(subscribeCanvasGrid, isCanvasGridEnabled, isCanvasGridEnabled);
}
