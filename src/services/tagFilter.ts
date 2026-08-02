/**
 * 标签筛选视图（B6）的状态 store。
 *
 * 模块级外部 store + `useSyncExternalStore`（与 `canvasSnapGuides` 的 `useSnapGuides`
 * 同一套写法）：点亮的标签要同时被 TagFilterBar（渲染点亮态）与每张卡片
 * （渲染 ghost 淡出态）读到，而卡片在 `CanvasNodeItem` 的 memo 边界深处，
 * 为一份全局筛选状态穿几层 props 不值得。
 *
 * 语义约定：
 * - `activeTags` 为空 = 不在筛选，所有卡片正常显示；
 * - 多标签是**并集**——命中任一点亮标签即算命中（高亮），其余卡片淡出。
 */

import { useSyncExternalStore } from 'react';
import type { CanvasNode } from '../db';

/** 稳定的空集合引用：useSyncExternalStore 要求同一状态返回同一引用。 */
const EMPTY_TAGS: ReadonlySet<string> = new Set();

let activeTags: ReadonlySet<string> = EMPTY_TAGS;
const listeners = new Set<() => void>();

function publish(next: Set<string>): void {
  activeTags = next.size === 0 ? EMPTY_TAGS : next;
  listeners.forEach((fn) => fn());
}

export function getActiveTags(): ReadonlySet<string> {
  return activeTags;
}

/** 点亮 / 熄灭一个标签。 */
export function toggleTag(tag: string): void {
  const next = new Set(activeTags);
  if (!next.delete(tag)) next.add(tag);
  publish(next);
}

export function clearTags(): void {
  if (activeTags.size === 0) return;
  publish(new Set());
}

/**
 * 标签被重命名 / 合并后同步筛选状态（由 `tagOps` 调用）。
 * 不同步的话，筛选会残留一个已经不存在的标签名——所有卡片全部淡出，
 * 标签栏上却没有任何点亮的 chip 可以解释这件事。
 */
export function renameActiveTag(from: string, to: string): void {
  if (!activeTags.has(from)) return;
  const next = new Set(activeTags);
  next.delete(from);
  next.add(to);
  publish(next);
}

/** 标签被删除后从筛选里移除（由 `tagOps` 调用）。 */
export function removeActiveTag(tag: string): void {
  if (!activeTags.has(tag)) return;
  const next = new Set(activeTags);
  next.delete(tag);
  publish(next);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 组件订阅当前点亮的标签集合；没有筛选时是稳定的空集合。 */
export function useTagFilter(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => activeTags);
}

/**
 * 节点是否命中当前筛选（纯函数）。
 * 没点亮任何标签时一律算命中——「不筛选」不等于「全部淡出」。
 * 多标签取并集：带任一点亮标签即命中。
 */
export function nodeMatchesTagFilter(
  node: Pick<CanvasNode, 'tags'>,
  tags: ReadonlySet<string>,
): boolean {
  if (tags.size === 0) return true;
  return (node.tags ?? []).some((t) => tags.has(t));
}

/** 仅供测试。 */
export function resetTagFilterForTests(): void {
  activeTags = EMPTY_TAGS;
  listeners.clear();
}
