/**
 * AI 流式中间态的内存 store。
 *
 * 流式期间每 ~100ms 更新一次正文，以前是直接写 Dexie——每次写库都会惊动
 * 当前画布的 live query，全部节点跟着重渲一遍：一张卡在生成，整个画布在陪跑。
 * 现在中间态只进这里，由正在流式的那一张卡用 `useAiStreamText` 订阅；
 * 生成完成后由 `canvasStreamingAi` 把最终文本一次性写库，再清掉这里的暂存。
 *
 * 语义不变的部分：**未完成的生成不落库**。中途崩溃/取消时库里仍然没有半截内容。
 */

import { useSyncExternalStore } from 'react';
import { markEdgesDirty } from './edgeGeometry';

const texts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function notify(nodeId: string): void {
  listeners.get(nodeId)?.forEach((fn) => fn());
}

export function setAiStreamText(nodeId: string, text: string): void {
  texts.set(nodeId, text);
  notify(nodeId);
  // 流式期间卡片在长高，下游连线的端点要跟着挪
  markEdgesDirty();
}

/**
 * 清掉暂存。落库后调用方会**延迟**清理（见 canvasStreamingAi）：
 * live query 把最终行送回组件要一两帧，立刻清会让卡片闪一下旧内容。
 */
export function clearAiStreamText(nodeId: string): void {
  if (!texts.delete(nodeId)) return;
  notify(nodeId);
}

export function getAiStreamText(nodeId: string): string | undefined {
  return texts.get(nodeId);
}

function subscribe(nodeId: string, fn: () => void): () => void {
  let set = listeners.get(nodeId);
  if (!set) {
    set = new Set();
    listeners.set(nodeId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(nodeId);
  };
}

/** 正在流式生成的那张卡用它读中间态；没有流时返回 undefined，调用方回落到库里的 content。 */
export function useAiStreamText(nodeId: string): string | undefined {
  return useSyncExternalStore(
    (fn) => subscribe(nodeId, fn),
    () => texts.get(nodeId),
  );
}

/** 仅供测试。 */
export function resetAiStreamStoreForTests(): void {
  texts.clear();
  listeners.clear();
}
