import { describe, it, expect } from 'vitest';
import {
  kvCacheBytesPerToken,
  planLocalRun,
  RUNTIME_RESERVE_BYTES,
  type GgufInfo,
  type HardwareInfo,
} from '../../src/services/localModelPlanner';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

/** 典型 8B Q4 量化：4GiB 文件、32 层、GQA（8 个 KV 头）→ KV cache 128KiB/token。 */
function gguf8b(over: Partial<GgufInfo> = {}): GgufInfo {
  return {
    fileBytes: 4 * GiB,
    version: 3,
    tensorCount: 291,
    architecture: 'llama',
    modelName: 'Test 8B Instruct',
    sizeLabel: '8B',
    quantLabel: 'Q4_K_M',
    blockCount: 32,
    contextLength: 32768,
    embeddingLength: 4096,
    headCount: 32,
    headCountKv: 8,
    hasChatTemplate: true,
    ...over,
  };
}

function hwWindows(over: Partial<HardwareInfo> = {}): HardwareInfo {
  return {
    totalRamBytes: 16 * GiB,
    availableRamBytes: 8 * GiB,
    physicalCores: 8,
    logicalCores: 16,
    gpus: [],
    platform: 'windows',
    unifiedMemory: false,
    ...over,
  };
}

describe('kvCacheBytesPerToken', () => {
  it('按 blockCount × headCountKv × headDim × 2(K+V) × 2 字节估算', () => {
    // 32 × 8 × (4096/32) × 2 × 2 = 131072
    expect(kvCacheBytesPerToken(gguf8b())).toBe(131072);
  });

  it('元数据缺失时用缺省：headCountKv←headCount←8，headDim←128，blocks←32', () => {
    const bare: GgufInfo = {
      fileBytes: GiB,
      version: 3,
      tensorCount: 1,
      hasChatTemplate: false,
    };
    // 32 × 8 × 128 × 2 × 2 = 131072
    expect(kvCacheBytesPerToken(bare)).toBe(131072);
    // headCountKv 缺省取 headCount
    expect(
      kvCacheBytesPerToken({ ...bare, headCount: 16, embeddingLength: 2048 }),
    ).toBe(32 * 16 * 128 * 2 * 2);
  });
});

describe('planLocalRun —— 4GB 独显 + 8B Q4（文档里那张人肉表的核心行）', () => {
  const hw = hwWindows({
    gpus: [{ name: 'GeForce RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
  });

  it('部分 offload：扣掉 512MB 余量与 KV 预算后按每层大小切分', () => {
    const plan = planLocalRun(gguf8b(), hw);
    // 可用显存 = 4GiB×0.8 = 3435973836；ctx 4096 的 KV = 512MiB；
    // 层预算 = 3435973836 − 512MiB − 512MiB = 2362232012；每层 = 4GiB/32 = 128MiB → 17 层
    expect(plan.nGpuLayers).toBe(17);
    expect(plan.nCtx).toBe(4096);
    expect(plan.nThreads).toBe(8);
    expect(plan.maxTokens).toBe(1024);
    expect(plan.fits).toBe('gpu-partial');
    expect(plan.advice).toBeUndefined();
  });

  it('占用估算：显存 = offload 权重 + KV + 余量；内存 = 剩余权重 + 余量', () => {
    const plan = planLocalRun(gguf8b(), hw);
    const offload = (4 * GiB * 17) / 32;
    expect(plan.estVramBytes).toBe(Math.round(offload + 512 * MiB + RUNTIME_RESERVE_BYTES));
    expect(plan.estRamBytes).toBe(Math.round(4 * GiB - offload + RUNTIME_RESERVE_BYTES));
  });

  it('显存很小时上下文降档（4096 → 2048）', () => {
    const tiny = hwWindows({
      gpus: [{ name: 'GT 1030', vendor: 'nvidia', dedicatedVramBytes: 1.25 * GiB }],
    });
    const plan = planLocalRun(gguf8b(), tiny);
    // 可用 = 1.25GiB×0.8 = 1GiB；ctx 4096 时 512MiB 余量 + 512MiB KV 刚好吃光 → 降到 2048
    expect(plan.nCtx).toBe(2048);
    expect(plan.nGpuLayers).toBe(2);
    expect(plan.fits).toBe('gpu-partial');
  });
});

describe('planLocalRun —— 24GB 卡全量 offload', () => {
  it('层预算 ≥ 总层数时全量：nGpuLayers = blockCount + 1', () => {
    const hw = hwWindows({
      availableRamBytes: 24 * GiB,
      gpus: [
        {
          name: 'GeForce RTX 4090',
          vendor: 'nvidia',
          dedicatedVramBytes: 24 * GiB,
          availableVramBytes: 22 * GiB,
        },
      ],
    });
    const plan = planLocalRun(gguf8b(), hw);
    expect(plan.nGpuLayers).toBe(33);
    expect(plan.nCtx).toBe(4096);
    expect(plan.fits).toBe('gpu-full');
    // availableVramBytes 优先于 dedicated×0.8；全部权重进显存
    expect(plan.estVramBytes).toBe(4 * GiB + 512 * MiB + RUNTIME_RESERVE_BYTES);
    // CPU 侧只剩运行余量
    expect(plan.estRamBytes).toBe(RUNTIME_RESERVE_BYTES);
  });
});

describe('planLocalRun —— 无独显 Windows（纯 CPU）', () => {
  it('nGpuLayers = 0，内存装得下就是 cpu-only', () => {
    const plan = planLocalRun(gguf8b(), hwWindows({ availableRamBytes: 16 * GiB }));
    expect(plan.nGpuLayers).toBe(0);
    expect(plan.nCtx).toBe(4096);
    expect(plan.fits).toBe('cpu-only');
    expect(plan.estVramBytes).toBe(0);
    expect(plan.estRamBytes).toBe(4 * GiB + 512 * MiB + RUNTIME_RESERVE_BYTES);
  });

  it('核显（专用显存为 0）不算独显，照走 CPU', () => {
    const plan = planLocalRun(
      gguf8b(),
      hwWindows({
        availableRamBytes: 16 * GiB,
        gpus: [{ name: 'Intel UHD 770', vendor: 'intel', dedicatedVramBytes: 0 }],
      }),
    );
    expect(plan.nGpuLayers).toBe(0);
    expect(plan.fits).toBe('cpu-only');
  });
});

describe('planLocalRun —— macOS 统一内存（Metal）', () => {
  const hw = hwWindows({
    platform: 'macos',
    unifiedMemory: true,
    availableRamBytes: 24 * GiB,
    physicalCores: 10,
    gpus: [{ name: 'Apple M2 Pro', vendor: 'apple', dedicatedVramBytes: 0 }],
  });

  it('全量 offload，预算按可用内存 × 0.8 计，显存与内存同数', () => {
    const plan = planLocalRun(gguf8b(), hw);
    expect(plan.nGpuLayers).toBe(33);
    expect(plan.nCtx).toBe(4096);
    expect(plan.nThreads).toBe(10);
    expect(plan.fits).toBe('gpu-full');
    const total = 4 * GiB + 512 * MiB + RUNTIME_RESERVE_BYTES;
    expect(plan.estVramBytes).toBe(total);
    expect(plan.estRamBytes).toBe(total);
  });

  it('统一内存也兜不住时判 wont-fit', () => {
    const small = { ...hw, availableRamBytes: 4 * GiB };
    const plan = planLocalRun(gguf8b(), small);
    expect(plan.fits).toBe('wont-fit');
    expect(plan.advice).toBe('smaller_quant');
  });
});

describe('planLocalRun —— 超大模型 wont-fit', () => {
  it('CPU 路径下模型比可用内存 × 0.8 还大：判 wont-fit 并建议换小量化', () => {
    const huge = gguf8b({
      fileBytes: 40 * GiB,
      blockCount: 80,
      headCount: 64,
      embeddingLength: 8192,
      modelName: 'Test 70B',
    });
    const plan = planLocalRun(huge, hwWindows({ availableRamBytes: 16 * GiB }));
    expect(plan.fits).toBe('wont-fit');
    expect(plan.advice).toBe('smaller_quant');
    // 全档位都装不下时用最小档
    expect(plan.nCtx).toBe(1024);
    expect(plan.nGpuLayers).toBe(0);
  });

  it('部分 offload 后 CPU 侧仍兜不住的也判 wont-fit', () => {
    const huge = gguf8b({ fileBytes: 40 * GiB, blockCount: 80, modelName: 'Test 70B' });
    const hw = hwWindows({
      availableRamBytes: 8 * GiB,
      gpus: [{ name: 'RTX 4090', vendor: 'nvidia', dedicatedVramBytes: 24 * GiB }],
    });
    const plan = planLocalRun(huge, hw);
    expect(plan.nGpuLayers).toBeGreaterThan(0);
    expect(plan.fits).toBe('wont-fit');
    expect(plan.advice).toBe('smaller_quant');
  });
});

describe('planLocalRun —— 训练上下文与生成上限', () => {
  it('nCtx 与训练上下文取 min', () => {
    const plan = planLocalRun(
      gguf8b({ contextLength: 2048 }),
      hwWindows({ availableRamBytes: 16 * GiB }),
    );
    expect(plan.nCtx).toBe(2048);
  });

  it('上下文被压到 1024 时 maxTokens 减半，给 prompt 留地方', () => {
    const plan = planLocalRun(
      gguf8b({ contextLength: 1024 }),
      hwWindows({ availableRamBytes: 16 * GiB }),
    );
    expect(plan.nCtx).toBe(1024);
    expect(plan.maxTokens).toBe(512);
  });
});

describe('planLocalRun —— 手动覆盖', () => {
  const hw = hwWindows({
    gpus: [{ name: 'RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
  });

  it('覆盖字段直接生效并重算估计', () => {
    const plan = planLocalRun(gguf8b(), hw, {
      nGpuLayers: 10,
      nCtx: 2048,
      nThreads: 4,
      maxTokens: 512,
    });
    expect(plan.nGpuLayers).toBe(10);
    expect(plan.nCtx).toBe(2048);
    expect(plan.nThreads).toBe(4);
    expect(plan.maxTokens).toBe(512);
    const offload = (4 * GiB * 10) / 32;
    const kv = 131072 * 2048;
    expect(plan.estVramBytes).toBe(Math.round(offload + kv + RUNTIME_RESERVE_BYTES));
    expect(plan.estRamBytes).toBe(Math.round(4 * GiB - offload + RUNTIME_RESERVE_BYTES));
    expect(plan.fits).toBe('gpu-partial');
  });

  it('覆盖为 0 层 → cpu-only；覆盖超过总层数 → gpu-full', () => {
    expect(planLocalRun(gguf8b(), hw, { nGpuLayers: 0 }).fits).toBe('cpu-only');
    expect(planLocalRun(gguf8b(), hw, { nGpuLayers: 40 }).fits).toBe('gpu-full');
  });

  it('只覆盖一项时其余仍走自动', () => {
    const plan = planLocalRun(gguf8b(), hw, { nThreads: 2 });
    expect(plan.nThreads).toBe(2);
    expect(plan.nGpuLayers).toBe(17);
    expect(plan.nCtx).toBe(4096);
  });
});

describe('planLocalRun —— 元数据缺失的兜底', () => {
  it('blockCount 未知时不赌 GPU 切分，自动方案走纯 CPU', () => {
    const plan = planLocalRun(
      gguf8b({ blockCount: undefined }),
      hwWindows({
        availableRamBytes: 16 * GiB,
        gpus: [{ name: 'RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
      }),
    );
    expect(plan.nGpuLayers).toBe(0);
    expect(plan.fits).toBe('cpu-only');
  });

  it('physicalCores 异常时线程数至少为 1', () => {
    const plan = planLocalRun(gguf8b(), hwWindows({ physicalCores: 0, availableRamBytes: 16 * GiB }));
    expect(plan.nThreads).toBe(1);
  });
});

describe('引擎后端门控（engineBackend）', () => {
  it('CPU 引擎一票否决：有 NVIDIA 独显也不做 offload', () => {
    const plan = planLocalRun(
      gguf8b(),
      hwWindows({
        gpus: [{ name: 'GeForce RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
      }),
      {},
      { engineBackend: 'cpu' },
    );
    expect(plan.nGpuLayers).toBe(0);
    expect(plan.fits).toBe('cpu-only');
    expect(plan.estVramBytes).toBe(0);
  });

  it('CUDA 引擎只认 NVIDIA：AMD 独显按纯 CPU 规划', () => {
    const plan = planLocalRun(
      gguf8b(),
      hwWindows({
        gpus: [{ name: 'RX 7800 XT', vendor: 'amd', dedicatedVramBytes: 16 * GiB }],
      }),
      {},
      { engineBackend: 'cuda' },
    );
    expect(plan.nGpuLayers).toBe(0);
    expect(plan.fits).toBe('cpu-only');
  });

  it('CUDA 引擎 + NVIDIA 卡照常规划；后端未知时按硬件乐观规划', () => {
    const hw = hwWindows({
      gpus: [{ name: 'GeForce RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
    });
    const withCuda = planLocalRun(gguf8b(), hw, {}, { engineBackend: 'cuda' });
    expect(withCuda.nGpuLayers).toBeGreaterThan(0);
    const unknown = planLocalRun(gguf8b(), hw, {}, { engineBackend: null });
    expect(unknown.nGpuLayers).toBeGreaterThan(0);
  });
});
