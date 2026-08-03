/**
 * 本地模型自动参数规划器（纯函数）。
 *
 * 把 docs/guide/LOCAL_LLM.md 里那张「显存 → 推荐 GPU 层数」的人肉表变成代码：
 * 输入 GGUF 元数据（Rust `gguf_inspect`）+ 硬件探测结果（Rust `hardware_probe`）
 * + 用户手动覆盖，输出一份完整的运行方案（GPU 层数 / 上下文 / 线程数 / 预估占用 /
 * 装不装得下）。
 *
 * 估算模型（全部用 bytes，展示层再格式化）：
 * - 每层大小 ≈ fileBytes / blockCount；
 * - KV cache/token ≈ blockCount × headCountKv × headDim × 2(K+V) × 2 字节(f16)，
 *   headCountKv 缺省取 headCount 再缺省 8，headDim = embeddingLength / headCount 缺省 128；
 * - 可用显存 = availableVramBytes ?? dedicatedVramBytes × 0.8，再扣 512MB 运行余量
 *   与所选上下文的 KV cache 预算；
 * - macOS / 统一内存：全量 offload（Metal），预算按可用内存 × 0.8 计；
 * - 估算永远保守：算错方向是「少 offload 几层」而不是 OOM，且手动覆盖永远在。
 */

export interface GgufInfo {
  fileBytes: number;
  version: number;
  tensorCount: number;
  architecture?: string;
  modelName?: string;
  sizeLabel?: string;
  quantLabel?: string;
  blockCount?: number;
  contextLength?: number;
  embeddingLength?: number;
  headCount?: number;
  headCountKv?: number;
  hasChatTemplate: boolean;
}

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
  dedicatedVramBytes: number;
  availableVramBytes?: number;
}

export interface HardwareInfo {
  totalRamBytes: number;
  availableRamBytes: number;
  physicalCores: number;
  logicalCores: number;
  gpus: GpuInfo[];
  platform: string;
  unifiedMemory: boolean;
}

/** 手动覆盖：给了哪项用哪项，没给的走自动。 */
export interface LocalRunOverrides {
  nGpuLayers?: number;
  nCtx?: number;
  nThreads?: number;
  maxTokens?: number;
}

export interface LocalRunOptions {
  /**
   * 实际安装的引擎后端（local_engine_status 的 backend）。
   * CPU 引擎带不动任何 GPU——就算机器插着 AMD/Intel 独显，也不能按 GPU 规划，
   * 否则 UI 显示「部分 GPU」而实际纯 CPU 在跑，预估全是错的。
   * CUDA 引擎只认 NVIDIA 卡。未知（null/undefined，状态还没查到）时按硬件乐观规划。
   */
  engineBackend?: 'cpu' | 'cuda' | 'metal' | null;
}

export type LocalRunFits = 'gpu-full' | 'gpu-partial' | 'cpu-only' | 'wont-fit';

export interface LocalRunPlan {
  /** 传给 llama-server 的 -ngl。全量 offload 时为 blockCount + 1。 */
  nGpuLayers: number;
  nCtx: number;
  nThreads: number;
  maxTokens: number;
  /** 预估显存占用；纯 CPU 时为 0。统一内存机器上与 estRamBytes 相同。 */
  estVramBytes: number;
  estRamBytes: number;
  fits: LocalRunFits;
  /** i18n key 后缀（`settings.local_advice_<key>`），仅 wont-fit 时给。 */
  advice?: string;
}

const MiB = 1024 * 1024;

/** llama-server 自身与激活值的运行余量，从显存/内存预算里预留出来。 */
export const RUNTIME_RESERVE_BYTES = 512 * MiB;

/** 上下文档位：目标 4096，不够就降档。 */
const CTX_LADDER = [4096, 2048, 1024];

const DEFAULT_MAX_TOKENS = 1024;

/** 元数据缺 blockCount 时估 KV cache 用的兜底层数（只用于估算，不用于 offload）。 */
const FALLBACK_KV_BLOCK_COUNT = 32;

/** 内存/显存只敢用八成——桌面与系统本身也要活。 */
const MEMORY_HEADROOM = 0.8;

/** KV cache 每 token 的字节数（K+V，f16）。 */
export function kvCacheBytesPerToken(gguf: GgufInfo): number {
  const blocks = gguf.blockCount ?? FALLBACK_KV_BLOCK_COUNT;
  const kvHeads = gguf.headCountKv ?? gguf.headCount ?? 8;
  const headDim =
    gguf.embeddingLength && gguf.headCount ? gguf.embeddingLength / gguf.headCount : 128;
  return blocks * kvHeads * headDim * 2 * 2;
}

/** 全量 offload 的 -ngl：比总层数多 1（含 output 层）；层数未知时给个大数。 */
function fullOffloadLayers(blockCount: number): number {
  return blockCount > 0 ? blockCount + 1 : 999;
}

/** macOS 统一内存架构：CPU/GPU 共享一块内存，Metal 全量 offload 是默认正解。 */
function isUnifiedMemory(hw: HardwareInfo): boolean {
  return hw.unifiedMemory || /mac|darwin/i.test(hw.platform);
}

/** 独显：取 gpus[0]（Rust 侧已按专用显存排序），核显（0 专用显存）不算。 */
function discreteGpu(hw: HardwareInfo): GpuInfo | null {
  const gpu = hw.gpus[0];
  return gpu && gpu.dedicatedVramBytes > 0 ? gpu : null;
}

/** 从大到小选第一个满足预算的档位；全都不满足就用最小档。 */
function pickCtx(ladder: number[], fits: (ctx: number) => boolean): number {
  for (const ctx of ladder) {
    if (fits(ctx)) return ctx;
  }
  return ladder[ladder.length - 1];
}

/** 上下文档位表：各档与训练上下文取 min 后去重（训练上下文小于档位时档位失去意义）。 */
function ctxLadder(gguf: GgufInfo): number[] {
  const cap = gguf.contextLength && gguf.contextLength > 0 ? gguf.contextLength : Infinity;
  const capped = CTX_LADDER.map((c) => Math.min(c, cap));
  return capped.filter((v, i) => capped.indexOf(v) === i);
}

/** nCtx 太小时 1024 的默认生成上限会挤掉 prompt 的空间，按上下文减半。 */
function autoMaxTokens(nCtx: number): number {
  return nCtx >= DEFAULT_MAX_TOKENS * 2
    ? DEFAULT_MAX_TOKENS
    : Math.max(256, Math.floor(nCtx / 2));
}

export function planLocalRun(
  gguf: GgufInfo,
  hw: HardwareInfo,
  overrides: LocalRunOverrides = {},
  options: LocalRunOptions = {},
): LocalRunPlan {
  const blockCount = gguf.blockCount ?? 0;
  const kvPerToken = kvCacheBytesPerToken(gguf);
  const ladder = ctxLadder(gguf);
  const unified = isUnifiedMemory(hw);
  const backend = options.engineBackend;
  const candidate = unified ? null : discreteGpu(hw);
  // 引擎后端一票否决：CPU 引擎不认任何卡；CUDA 引擎只认 NVIDIA
  const gpu =
    backend === 'cpu'
      ? null
      : backend === 'cuda' && candidate?.vendor !== 'nvidia'
        ? null
        : candidate;
  const ramBudget = Math.floor(hw.availableRamBytes * MEMORY_HEADROOM);

  // ── 自动方案 ──
  let autoGpuLayers: number;
  let autoCtx: number;

  if (unified) {
    // Metal：权重全量进统一内存，预算就是可用内存
    autoGpuLayers = fullOffloadLayers(blockCount);
    autoCtx = pickCtx(
      ladder,
      (ctx) => gguf.fileBytes + kvPerToken * ctx + RUNTIME_RESERVE_BYTES <= ramBudget,
    );
  } else if (gpu) {
    const availVram = Math.floor(
      gpu.availableVramBytes ?? gpu.dedicatedVramBytes * MEMORY_HEADROOM,
    );
    // 先选上下文：从大到小找第一个扣掉余量与 KV 预算后还有层预算的档位
    autoCtx = pickCtx(ladder, (ctx) => availVram - RUNTIME_RESERVE_BYTES - kvPerToken * ctx > 0);
    const layerBudget = availVram - RUNTIME_RESERVE_BYTES - kvPerToken * autoCtx;
    if (layerBudget <= 0 || blockCount <= 0) {
      // 层数未知没法按层切分，宁可全走 CPU 也不赌一把 OOM
      autoGpuLayers = 0;
    } else {
      const perLayer = gguf.fileBytes / blockCount;
      const layers = Math.min(blockCount, Math.floor(layerBudget / perLayer));
      autoGpuLayers = layers >= blockCount ? fullOffloadLayers(blockCount) : layers;
    }
  } else {
    // 无独显的 Windows / Linux：纯 CPU
    autoGpuLayers = 0;
    autoCtx = pickCtx(
      ladder,
      (ctx) => gguf.fileBytes + kvPerToken * ctx + RUNTIME_RESERVE_BYTES <= ramBudget,
    );
  }

  // ── 手动覆盖直接生效，之后的估算与判定基于最终值 ──
  const nGpuLayers = overrides.nGpuLayers ?? autoGpuLayers;
  const nCtx = overrides.nCtx ?? autoCtx;
  const nThreads = Math.max(1, overrides.nThreads ?? hw.physicalCores);
  const maxTokens = overrides.maxTokens ?? autoMaxTokens(nCtx);

  // ── 占用估算与装载判定 ──
  const kvBytes = kvPerToken * nCtx;
  // offload 比例：层数未知时只认全有（>0 视为全量）或全无
  const offloadFraction =
    blockCount > 0
      ? Math.min(nGpuLayers, blockCount) / blockCount
      : nGpuLayers > 0
        ? 1
        : 0;
  const offloadBytes = gguf.fileBytes * offloadFraction;
  const cpuWeightBytes = gguf.fileBytes - offloadBytes;
  // KV cache 跟着 offload 走：有任何层在 GPU 上时按放显存估（保守方向）
  const kvOnGpu = offloadFraction > 0;

  let estVramBytes: number;
  let estRamBytes: number;
  if (unified) {
    // 统一内存：显存就是内存，一份占用两边同数
    const total = Math.round(
      offloadFraction > 0 ? gguf.fileBytes + kvBytes + RUNTIME_RESERVE_BYTES : 0,
    );
    estVramBytes = total;
    estRamBytes =
      offloadFraction > 0
        ? total
        : Math.round(gguf.fileBytes + kvBytes + RUNTIME_RESERVE_BYTES);
  } else {
    estVramBytes =
      offloadFraction > 0
        ? Math.round(offloadBytes + kvBytes + RUNTIME_RESERVE_BYTES)
        : 0;
    estRamBytes = Math.round(
      cpuWeightBytes + (kvOnGpu ? 0 : kvBytes) + RUNTIME_RESERVE_BYTES,
    );
  }

  // wont-fit：CPU（或统一内存）一侧兜不住模型时，换小量化比调参数有用
  const residentInRam = unified
    ? gguf.fileBytes + kvBytes + RUNTIME_RESERVE_BYTES
    : cpuWeightBytes + (kvOnGpu ? 0 : kvBytes);
  const wontFit = residentInRam > ramBudget;

  let fits: LocalRunFits;
  if (wontFit) {
    fits = 'wont-fit';
  } else if (offloadFraction >= 1 && nGpuLayers > 0) {
    fits = 'gpu-full';
  } else if (offloadFraction > 0) {
    fits = 'gpu-partial';
  } else {
    fits = 'cpu-only';
  }

  return {
    nGpuLayers,
    nCtx,
    nThreads,
    maxTokens,
    estVramBytes,
    estRamBytes,
    fits,
    ...(fits === 'wont-fit' ? { advice: 'smaller_quant' } : {}),
  };
}
