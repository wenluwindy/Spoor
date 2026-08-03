import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { LocalModelSection } from '../../src/components/settings/LocalModelSection';
import type { AIProviderProfile } from '../../src/types/aiConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
    i18n: { language: 'zh' },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const GiB = 1024 ** 3;

const ggufInfo = {
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
};

// 4GB N 卡：规划器给 17 层 / 4096 ctx / 8 线程 → 「部分 GPU」
const hardwareInfo = {
  totalRamBytes: 16 * GiB,
  availableRamBytes: 8 * GiB,
  physicalCores: 8,
  logicalCores: 16,
  gpus: [{ name: 'RTX 3050', vendor: 'nvidia', dedicatedVramBytes: 4 * GiB }],
  platform: 'windows',
  unifiedMemory: false,
};

function makeProvider(patch: Partial<AIProviderProfile> = {}): AIProviderProfile {
  return {
    id: 'p1',
    name: '本地',
    kind: 'local_llama',
    apiKey: '',
    baseUrl: '',
    chatModels: [{ id: 'c1', modelName: 'local', label: 'local' }],
    imageModels: [],
    localGgufPath: 'D:\\Models\\m.gguf',
    ...patch,
  };
}

function stubInvoke(overrides: Record<string, unknown> = {}) {
  mockInvoke.mockImplementation((cmd: unknown) => {
    if (cmd !== undefined && Object.prototype.hasOwnProperty.call(overrides, String(cmd))) {
      const v = overrides[String(cmd)];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    switch (cmd) {
      case 'gguf_inspect':
        return Promise.resolve(ggufInfo);
      case 'hardware_probe':
        return Promise.resolve(hardwareInfo);
      case 'local_engine_status':
        // 默认场景：装好 CUDA 加速的 NVIDIA 机器——引擎后端门控下，
        // 「部分 GPU」徽章只有 backend 能带动这块卡时才成立
        return Promise.resolve({
          installed: true,
          backend: 'cuda',
          path: 'C:\\Spoor\\llama',
          nvidiaDetected: true,
          cudaInstalled: true,
        });
      case 'local_server_state':
        return Promise.resolve({ running: false });
      default:
        return Promise.reject(new Error(`unexpected invoke: ${String(cmd)}`));
    }
  });
}

describe('LocalModelSection', () => {
  let savedTauri: unknown;

  beforeEach(() => {
    savedTauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    // 组件里的动态 import 偶发拿到真模块（vitest 动态导入的 mock 竞态），
    // 让真模块的 invoke 也落到同一个 mockInvoke 上，两条路殊途同归。
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      __mock: true,
      invoke: (cmd: unknown, args: unknown) => mockInvoke(cmd, args),
      transformCallback: (cb: unknown) => cb,
    };
    mockInvoke.mockReset();
    stubInvoke();
  });

  afterEach(() => {
    if (savedTauri === undefined) {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    } else {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = savedTauri;
    }
  });

  it('网页环境只提示桌面版可用，不发任何 invoke', () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);
    expect(screen.getByText('errors.ai.local_desktop_only')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('选完文件出模型卡与自动参数卡（部分 GPU 徽章 + 规划值）', async () => {
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);

    expect(await screen.findByText('Test 8B Instruct')).toBeInTheDocument();
    // 规划器输出：17 层 / 4096 上下文 / 8 线程 / 1024 生成上限
    expect(await screen.findByText('17')).toBeInTheDocument();
    expect(screen.getByText('4096')).toBeInTheDocument();
    expect(screen.getByText('1024')).toBeInTheDocument();
    expect(screen.getByText('settings.local_fit_gpu_partial')).toBeInTheDocument();
    // 硬件摘要行：GPU 名 + 显存 + 内存 + 物理核
    expect(screen.getByText(/RTX 3050/)).toBeInTheDocument();
  });

  it('「选择模型文件…」走 user_file_pick_open_path（gguf filter）并回写路径', async () => {
    const onPatch = vi.fn();
    stubInvoke({ user_file_pick_open_path: 'D:\\picked\\model.gguf' });
    render(<LocalModelSection provider={makeProvider({ localGgufPath: undefined })} onPatch={onPatch} />);

    await userEvent.click(screen.getByRole('button', { name: /local_pick_model/ }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({ localGgufPath: 'D:\\picked\\model.gguf' });
    });
    const pickCall = mockInvoke.mock.calls.find((c) => c[0] === 'user_file_pick_open_path');
    expect(pickCall?.[1]).toEqual({ filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
  });

  it('选错文件给人话：not_a_gguf → 「不是 GGUF」文案', async () => {
    stubInvoke({ gguf_inspect: new Error('not_a_gguf') });
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);
    expect(await screen.findByText('settings.local_gguf_err_not_gguf')).toBeInTheDocument();
  });

  it('检测到 N 卡且未装 CUDA 时给内联提示条，「跳过」可关掉', async () => {
    stubInvoke({
      local_engine_status: {
        installed: true,
        backend: 'cpu',
        nvidiaDetected: true,
        cudaInstalled: false,
      },
    });
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);

    expect(await screen.findByText('settings.local_cuda_offer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'settings.local_cuda_skip' }));
    expect(screen.queryByText('settings.local_cuda_offer')).not.toBeInTheDocument();
  });

  it('引擎缺失时给一句人话与文档链接', async () => {
    stubInvoke({
      local_engine_status: { installed: false, nvidiaDetected: false, cudaInstalled: false },
    });
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);
    expect(await screen.findByText(/settings\.local_engine_missing/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'settings.local_engine_docs' })).toBeInTheDocument();
  });

  it('server 运行中显示驻留状态，「卸载模型」调 local_server_stop', async () => {
    stubInvoke({ local_server_state: { running: true, port: 8123 } });
    render(<LocalModelSection provider={makeProvider()} onPatch={vi.fn()} />);

    expect(await screen.findByText(/local_engine_server_running/)).toBeInTheDocument();
    stubInvoke({ local_server_state: { running: false } });
    await userEvent.click(screen.getByRole('button', { name: 'settings.local_engine_unload' }));
    await waitFor(() => {
      expect(mockInvoke.mock.calls.some((c) => c[0] === 'local_server_stop')).toBe(true);
    });
  });

  it('高级参数逐项覆盖：输入回写 localN* 字段，「恢复自动」清空', async () => {
    const onPatch = vi.fn();
    render(
      <LocalModelSection
        provider={makeProvider({ localNGpuLayers: 8 })}
        onPatch={onPatch}
      />,
    );

    await screen.findByText('Test 8B Instruct');
    const input = screen.getByLabelText('settings.local_plan_gpu_layers', {
      selector: 'input',
    }) as HTMLInputElement;
    expect(input.value).toBe('8');
    // 自动值作 placeholder（未覆盖项）
    const ctxInput = screen.getByLabelText('settings.local_plan_ctx', {
      selector: 'input',
    }) as HTMLInputElement;
    expect(ctxInput.placeholder).toBe('4096');

    await userEvent.click(screen.getByRole('button', { name: 'settings.local_reset_auto' }));
    expect(onPatch).toHaveBeenCalledWith({
      localNGpuLayers: undefined,
      localNCtx: undefined,
      localNThreads: undefined,
      localMaxTokens: undefined,
    });
  });

  it('模型保留时长下拉：会话期常驻写 null，用后即退写 0', async () => {
    const onPatch = vi.fn();
    render(<LocalModelSection provider={makeProvider()} onPatch={onPatch} />);

    const select = screen.getByLabelText('settings.local_keep_alive');
    await userEvent.selectOptions(select, 'session');
    expect(onPatch).toHaveBeenCalledWith({ localKeepAliveMinutes: null });
    await userEvent.selectOptions(select, '0');
    expect(onPatch).toHaveBeenCalledWith({ localKeepAliveMinutes: 0 });
  });
});
