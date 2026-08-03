import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testChatModel } from '../../src/services/aiConfigTest';
import { isAppError } from '../../src/services/appError';
import type { AIProviderProfile } from '../../src/types/aiConfig';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

/**
 * 本地模型的连通性测试不再真跑一轮推理（旧实现 5–10 秒起步）：
 * 引擎装着 + GGUF 读得动 = 通过。
 */

function localProvider(over: Partial<AIProviderProfile> = {}): AIProviderProfile {
  return {
    id: 'p1',
    name: '本地',
    kind: 'local_llama',
    apiKey: '',
    baseUrl: '',
    chatModels: [{ id: 'c1', modelName: 'local', label: 'local' }],
    imageModels: [],
    localGgufPath: 'D:\\Models\\m.gguf',
    ...over,
  };
}

const ggufInfo = {
  fileBytes: 4 * 1024 ** 3,
  version: 3,
  tensorCount: 291,
  modelName: 'Test 8B',
  sizeLabel: '8B',
  quantLabel: 'Q4_K_M',
  hasChatTemplate: true,
};

function errorCode(result: { ok: boolean; error?: unknown }): string | undefined {
  return !result.ok && isAppError(result.error) ? result.error.code : undefined;
}

describe('testChatModel —— local_llama 分支', () => {
  let savedTauri: unknown;

  beforeEach(() => {
    savedTauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { __mock: true };
    mockInvoke.mockReset();
  });

  afterEach(() => {
    if (savedTauri === undefined) {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    } else {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = savedTauri;
    }
  });

  it('引擎已装 + GGUF 可读 → 通过，摘要给模型卡信息，不发起任何推理', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'local_engine_status') {
        return Promise.resolve({ installed: true, backend: 'cpu', nvidiaDetected: false, cudaInstalled: false });
      }
      if (cmd === 'gguf_inspect') return Promise.resolve(ggufInfo);
      return Promise.reject(new Error(`unexpected invoke: ${String(cmd)}`));
    });

    const result = await testChatModel(localProvider(), 'ignored');
    expect(result).toEqual({ ok: true, sample: 'Test 8B · 8B · Q4_K_M' });
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['local_engine_status', 'gguf_inspect']);
  });

  it('网页环境直接失败：ai.local_desktop_only', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const result = await testChatModel(localProvider(), '');
    expect(errorCode(result)).toBe('ai.local_desktop_only');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('未选模型文件：ai.local_no_path', async () => {
    const result = await testChatModel(localProvider({ localGgufPath: '  ' }), '');
    expect(errorCode(result)).toBe('ai.local_no_path');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('引擎未安装：ai.local_engine_missing，且不再去读 GGUF', async () => {
    mockInvoke.mockResolvedValueOnce({ installed: false, nvidiaDetected: false, cudaInstalled: false });
    const result = await testChatModel(localProvider(), '');
    expect(errorCode(result)).toBe('ai.local_engine_missing');
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['local_engine_status']);
  });

  it('GGUF 读不动：ai.local_gguf_invalid，detail 带 Rust 错误串', async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === 'local_engine_status') {
        return Promise.resolve({ installed: true, nvidiaDetected: false, cudaInstalled: false });
      }
      return Promise.reject('unsupported_gguf_version_1');
    });
    const result = await testChatModel(localProvider(), '');
    expect(errorCode(result)).toBe('ai.local_gguf_invalid');
    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: unknown }).error;
    expect(isAppError(err) ? err.detail : undefined).toContain('unsupported_gguf_version_1');
  });
});
