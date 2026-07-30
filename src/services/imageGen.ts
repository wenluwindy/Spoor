import { isTauriRuntime } from '../utils/isTauriRuntime';
import type { ResolvedImageModel } from './aiConfig';

/**
 * 生图的前端门面：组请求、限并发、把 Rust 的错误码原样带出来。
 *
 * 实际的请求、下载、落盘全在 Rust（`src-tauri/src/imagegen.rs`），
 * 这里只传路径和参数，拿回相对路径。
 */

/** 同时最多跑两个。再多的话画布会被一堆骨架屏占满，各家也大多有并发限制。 */
export const IMAGE_GEN_MAX_CONCURRENCY = 2;

/** Rust 侧归一后的错误码。前端用 `t('imagegen.errors.' + code)` 翻译。 */
export interface ImageGenFailure {
  code: string;
  httpStatus?: number;
  detail?: string;
}

export function isImageGenFailure(e: unknown): e is ImageGenFailure {
  return typeof e === 'object' && e !== null && typeof (e as ImageGenFailure).code === 'string';
}

export interface GenerateImagesParams {
  taskId: string;
  target: ResolvedImageModel;
  prompt: string;
  /** 参考图：相对路径或 data URL。 */
  refImages: string[];
  size?: string;
  n?: number;
}

// ───────────────────────────── 并发队列 ─────────────────────────────

let running = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < IMAGE_GEN_MAX_CONCURRENCY) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) {
    // 名额直接转交，不先减再加，避免中间态被别的调用抢走
    next();
    return;
  }
  running = Math.max(0, running - 1);
}

/** 排队中的任务数，仅供 UI 显示与测试断言。 */
export function pendingImageGenCount(): number {
  return waiting.length;
}

/** 测试用：把队列与模块缓存恢复到初始状态。 */
export function resetImageGenQueue(): void {
  running = 0;
  waiting.length = 0;
  invokePromise = null;
}

// ───────────────────────────── 调用 ─────────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokePromise: Promise<InvokeFn> | null = null;

/**
 * 只解析一次 `@tauri-apps/api/core`。
 *
 * 生图是唯一会并发跑的调用（默认 2 个），而并发触发同一个 specifier 的动态
 * import 会踩到解析竞态——实测有调用拿到未被 mock 的模块实例。缓存掉之后
 * 既没有竞态，也省了每次生成重新解析模块。
 */
function getInvoke(): Promise<InvokeFn> {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then((m) => m.invoke as InvokeFn);
  }
  return invokePromise;
}

async function invokeGenerate(params: GenerateImagesParams): Promise<string[]> {
  const invoke = await getInvoke();
  const { target } = params;
  return invoke<string[]>('image_generate', {
    req: {
      apiKind: target.apiKind,
      baseUrl: target.provider.baseUrl,
      apiKey: target.provider.apiKey,
      model: target.model.modelName,
      prompt: params.prompt,
      refImages: params.refImages,
      size: params.size ?? target.model.defaultParams?.size ?? null,
      n: params.n ?? target.model.defaultParams?.n ?? null,
      quality: target.model.defaultParams?.quality ?? null,
      taskId: params.taskId,
    },
  });
}

/**
 * 生成图片，返回数据根内的相对路径。
 *
 * 抛出的是 [`ImageGenFailure`]（Rust 归一过的错误码），不是 Error——
 * 调用方按 `code` 翻译，`detail` 折叠显示。
 */
export async function generateImages(params: GenerateImagesParams): Promise<string[]> {
  if (!isTauriRuntime()) {
    throw { code: 'desktop_only' } satisfies ImageGenFailure;
  }

  await acquire();
  try {
    return await invokeGenerate(params);
  } finally {
    release();
  }
}

/** 取消一个进行中的任务。已结束的任务是空操作。 */
export async function cancelImageGeneration(taskId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const invoke = await getInvoke();
  await invoke('image_generate_cancel', { taskId });
}
