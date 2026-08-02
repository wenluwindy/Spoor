/**
 * 镜像脏信号。db.ts 的表钩子在任何行变化时喊一声，镜像调度器订阅后防抖落盘。
 *
 * 单独成模块且**零依赖**：db.ts 要 import 它（钩子里发信号），
 * 镜像调度器也要 import 它（收信号），两头都不能通过它间接引入对方。
 */

/** 画布级作用域用 canvasId；全局表用固定名。 */
export type MirrorScope = string | 'articles' | 'agents' | 'templates';

type Listener = (scope: MirrorScope) => void;

const listeners = new Set<Listener>();

export function notifyMirrorChange(scope: MirrorScope): void {
  listeners.forEach((fn) => fn(scope));
}

export function subscribeMirrorChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 仅供测试。 */
export function resetMirrorSignalsForTests(): void {
  listeners.clear();
}
