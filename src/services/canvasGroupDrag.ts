/**
 * 多选整体拖拽的广播通道。
 *
 * 每个 `DraggableNode` 用 `useDraggable` 持有自己的本地坐标，彼此不知道对方存在，
 * 所以拖动只会动一个。这里用一个极小的 pub/sub 把「被按住的那张卡」（leader）
 * 的位移广播给同在选区里的其它卡（follower），三个阶段：
 *
 *   begin(leaderId, ids) → delta(dx, dy) … → end()
 *
 * follower 在 `begin` 时记下自己当时的坐标作基准，之后一律按「基准 + 位移」定位——
 * 而不是累加每帧增量，那样浮点误差会让选区在长距离拖拽后散开。
 *
 * 与 `appTheme` / `canvasGrid` 同构：用 store 而非 Context，避免整块画布跟着重渲染。
 */

export type GroupDragEvent =
  | { type: 'begin'; leaderId: string; ids: string[] }
  | { type: 'delta'; leaderId: string; dx: number; dy: number }
  | { type: 'end'; leaderId: string };

const listeners = new Set<(event: GroupDragEvent) => void>();

let activeLeaderId: string | null = null;

export function subscribeGroupDrag(listener: (event: GroupDragEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: GroupDragEvent) {
  listeners.forEach((fn) => fn(event));
}

export function beginGroupDrag(leaderId: string, ids: string[]): void {
  activeLeaderId = leaderId;
  emit({ type: 'begin', leaderId, ids });
}

export function publishGroupDelta(leaderId: string, dx: number, dy: number): void {
  if (activeLeaderId !== leaderId) return;
  emit({ type: 'delta', leaderId, dx, dy });
}

export function endGroupDrag(leaderId: string): void {
  if (activeLeaderId !== leaderId) return;
  activeLeaderId = null;
  emit({ type: 'end', leaderId });
}

export function getGroupDragLeaderId(): string | null {
  return activeLeaderId;
}

/** 仅供测试：清掉进行中的组拖与订阅者。 */
export function resetGroupDragForTests(): void {
  activeLeaderId = null;
  listeners.clear();
}
