/**
 * 画布网格开关的外部 store。
 *
 * 一个开关同时管两件事：网格点阵的显示、以及拖拽时卡片对齐到格点。
 * 与 `appTheme` 同构（store + `useSyncExternalStore`），原因也一样：
 * 读它的是每个节点的拖拽逻辑，套 Provider 会让整块画布跟着重渲染。
 */

/** 与 `index.css` 里 `.canvas-grid` 的 `background-size` 保持一致，否则吸附点对不上视觉格点。 */
export const CANVAS_GRID_SIZE = 24;

export const CANVAS_GRID_STORAGE_KEY = 'canvas_grid';

const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(CANVAS_GRID_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = readStored();

export function isCanvasGridEnabled(): boolean {
  return enabled;
}

export function setCanvasGridEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  try {
    localStorage.setItem(CANVAS_GRID_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // 存不下就只在本次会话生效
  }
  listeners.forEach((fn) => fn());
}

export function toggleCanvasGrid(): void {
  setCanvasGridEnabled(!enabled);
}

export function subscribeCanvasGrid(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 把坐标对齐到格点；`size <= 0` 视为不吸附。 */
export function snapToGrid(value: number, size: number = CANVAS_GRID_SIZE): number {
  if (!Number.isFinite(size) || size <= 0) return value;
  return Math.round(value / size) * size;
}

/** 仅供测试：把 store 复位到 localStorage 的当前值。 */
export function resetCanvasGridStoreForTests(): void {
  enabled = readStored();
  listeners.forEach((fn) => fn());
}
