/**
 * 镜像调度器（0.5.0「笔记落文件」的落盘半边）。
 *
 * 订阅 db 钩子发出的脏信号（mirrorSignals），防抖 2 秒后把脏了的画布/全局表
 * 重新序列化，经 Rust `notes_write`（原子写）落到 `SpoorData/notes/`。
 *
 * 三条纪律：
 * 1. **防抖窗口内合并**——0.4.0 刚把高频写库消灭，镜像不能把它请回来。
 *    连续编辑只在停手 2 秒后写一次盘。
 * 2. **记账走 `mirrorState` 表**（无钩子），写记账不会再触发镜像，杜绝自激。
 * 3. **串行 flush**——上一轮还没写完就到点的下一轮排队，同一文件不并发写。
 */

import { db, type MirrorStateRow } from '../db';
import { subscribeMirrorChanges, type MirrorScope } from './mirrorSignals';
import {
  buildCanvasMirrorContent,
  buildGlobalMirrorContent,
  canvasMirrorFileName,
  GLOBAL_MIRROR_FILES,
} from './canvasMirror';
import { logger } from '../utils/logger';

export const MIRROR_DEBOUNCE_MS = 2000;

export interface MirrorIo {
  write: (name: string, content: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

async function tauriMirrorIo(): Promise<MirrorIo> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    write: (name, content) => invoke('notes_write', { name, content }),
    remove: (name) => invoke('notes_delete', { name }),
  };
}

let stop: (() => void) | null = null;

interface SchedulerHandle {
  /** 等到当前防抖窗口与进行中的 flush 全部结束（测试与退出前用）。 */
  flushNow: () => Promise<void>;
  stop: () => void;
}

async function nextState(id: string, savedAt: number): Promise<MirrorStateRow> {
  const prev = await db.mirrorState.get(id);
  return { id, revision: (prev?.revision ?? 0) + 1, lastSavedAt: savedAt };
}

/** 把一个作用域落盘。画布已删除时删文件与记账行。 */
async function flushScope(scope: MirrorScope, io: MirrorIo): Promise<void> {
  const savedAt = Date.now();
  if (scope === 'articles' || scope === 'agents' || scope === 'templates') {
    const rows =
      scope === 'articles'
        ? await db.articles.toArray()
        : scope === 'agents'
          ? await db.agents.toArray()
          : await db.templates.toArray();
    const state = await nextState(scope, savedAt);
    await io.write(GLOBAL_MIRROR_FILES[scope], buildGlobalMirrorContent(scope, rows, state.revision, savedAt));
    await db.mirrorState.put(state);
    return;
  }

  const canvas = await db.canvases.get(scope);
  if (!canvas) {
    // 画布没了（删除画布/对账清理）：镜像文件与记账一起走
    await io.remove(canvasMirrorFileName(scope));
    await db.mirrorState.delete(scope);
    return;
  }
  const [nodes, edges, aiTurns] = await Promise.all([
    db.nodes.where('canvasId').equals(scope).toArray(),
    db.edges.where('canvasId').equals(scope).toArray(),
    db.aiTurns.where('canvasId').equals(scope).toArray(),
  ]);
  const state = await nextState(scope, savedAt);
  await io.write(
    canvasMirrorFileName(scope),
    buildCanvasMirrorContent({ canvas, nodes, edges, aiTurns, revision: state.revision, savedAt }),
  );
  await db.mirrorState.put(state);
}

export function startMirrorScheduler(options: {
  io: MirrorIo;
  debounceMs?: number;
}): SchedulerHandle {
  const debounceMs = options.debounceMs ?? MIRROR_DEBOUNCE_MS;
  const dirty = new Set<MirrorScope>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  const flush = () => {
    timer = null;
    const scopes = [...dirty];
    dirty.clear();
    // 串到上一轮后面：同一文件绝不并发写
    running = running.then(async () => {
      for (const scope of scopes) {
        if (stopped) return;
        try {
          await flushScope(scope, options.io);
        } catch (e) {
          // 单个作用域失败不挡别人；下次该作用域再变时会重试
          logger.error('mirror', 'flush failed', { scope, error: String(e) });
          dirty.add(scope);
        }
      }
    });
  };

  const unsubscribe = subscribeMirrorChanges((scope) => {
    if (stopped) return;
    dirty.add(scope);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  return {
    flushNow: async () => {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      await running;
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    },
  };
}

/** 应用启动时的一次性入口（仅桌面端）。对账（mirrorReconcile）完成后再调。 */
export async function initMirrorScheduler(): Promise<SchedulerHandle> {
  if (stop) throw new Error('mirror scheduler already started');
  const io = await tauriMirrorIo();
  const handle = startMirrorScheduler({ io });
  stop = handle.stop;
  return handle;
}
