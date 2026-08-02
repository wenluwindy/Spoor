/**
 * AI 整理的预览计划 store：分组算好后先摆虚影，用户点「应用」才落库。
 * 破坏性操作（挪动一堆卡）绝不跳过预览直接执行——这是 C8 的底线。
 */

import { useSyncExternalStore } from 'react';
import type { OrganizePlan } from './canvasOrganize';

let pending: OrganizePlan | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function setPendingOrganizePlan(plan: OrganizePlan | null): void {
  pending = plan;
  notify();
}

export function getPendingOrganizePlan(): OrganizePlan | null {
  return pending;
}

export function usePendingOrganizePlan(): OrganizePlan | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => pending,
  );
}

/** 仅供测试。 */
export function resetOrganizePreviewForTests(): void {
  pending = null;
  listeners.clear();
}
