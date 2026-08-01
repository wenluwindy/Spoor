import { useSyncExternalStore } from 'react';
import {
  getCanvasHistoryState,
  subscribeCanvasHistory,
  type CanvasHistoryState,
} from '../services/canvasHistory';

/**
 * 订阅某张画布的撤销 / 重做可用状态。
 *
 * 与 `useCanvasGrid` 同构（外部 store + `useSyncExternalStore`）：读它的是工具栏按钮，
 * 而写它的是每一次画布编辑，套 Provider 会让整块画布跟着重渲染。
 */
export function useCanvasHistory(canvasId: string): CanvasHistoryState {
  const getSnapshot = () => getCanvasHistoryState(canvasId);
  return useSyncExternalStore(subscribeCanvasHistory, getSnapshot, getSnapshot);
}
